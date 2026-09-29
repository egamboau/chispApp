import { Request, RequestHandler } from "express";
import { z } from "zod";
import { MatchFilters } from "../models/match";
import { MatchService } from "../service/match_service";
import { PlayerService } from "../service/player_service";
import { notify } from "../utils/events";

const idSchema = z.coerce.number().int().positive();
const scoreSchema = z.object({ team: z.enum(['A', 'B']), delta: z.union([z.literal(-1), z.literal(1)]) });
const resultSchema = z.object({ scoreA: z.coerce.number().int().nonnegative(), scoreB: z.coerce.number().int().nonnegative() });
const cardsSchema = z.object({
    yellowCardsA: z.coerce.number().int().nonnegative(), redCardsA: z.coerce.number().int().nonnegative(),
    yellowCardsB: z.coerce.number().int().nonnegative(), redCardsB: z.coerce.number().int().nonnegative(),
});
const scoringFields = {
    directGoals: z.coerce.number().int().nonnegative(),
    horquetas: z.coerce.number().int().nonnegative(),
    pepitas: z.coerce.number().int().nonnegative(),
};
const scoringTableSchema = z.string().trim().min(1).max(100);
const hasScoring = (value: { directGoals: number; horquetas: number; pepitas: number }) => value.directGoals + value.horquetas + value.pepitas > 0;
const scoringSchema = z.object({ ...scoringFields, scoringTable: scoringTableSchema.optional() }).refine(hasScoring);
const newScoringSchema = z.object({ playerId: idSchema, ...scoringFields, scoringTable: scoringTableSchema.default('Torneo Regular') }).refine(hasScoring);

type AdminRequest = Request & { isAdmin?: boolean };

export class MatchController {
    constructor(
        private readonly service: MatchService,
        private readonly playerService: PlayerService,
    ) {}

    getMatches: RequestHandler = (req, res) => {
        const filters: MatchFilters = {}
        for (const key of ['phaseId', 'groupId'] as const) {
            if (req.query[key]) {
                const value = idSchema.safeParse(req.query[key])
                if (!value.success) return res.status(400).json({ error: `${key} inválido.` })
                filters[key] = value.data
            }
        }
        if (req.query.tournamentType) {
            const value = z.enum(['MALE', 'FEMALE']).safeParse(req.query.tournamentType)
            if (!value.success) return res.status(400).json({ error: 'Torneo inválido.' })
            filters.tournamentType = value.data
        }
        if (req.query.status) {
            const value = z.enum(['SCHEDULED', 'LIVE', 'FINISHED']).safeParse(req.query.status)
            if (!value.success) return res.status(400).json({ error: 'Estado inválido.' })
            filters.status = value.data
        }
        if (typeof req.query.date === 'string') filters.date = req.query.date
        res.json(this.service.getMatches(filters, Boolean((req as AdminRequest).isAdmin)))
    }

    getMatch: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id)
        if (!id.success) return res.status(400).json({ error: 'Id de partido inválido.' })
        const match = this.service.getMatch(id.data, Boolean((req as AdminRequest).isAdmin))
        return match ? res.json(match) : res.status(404).json({ error: 'Partido no encontrado.' })
    }

    insertMatch: RequestHandler = (req, res) => {
        const { match, errors } = this.service.buildInput(req.body)
        if (errors.length) return res.status(400).json({ error: errors.join(' ') })
        const created = this.service.insertMatch(match)
        notify('created', created.id)
        res.status(201).json(created)
    }

    updateMatch: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id)
        if (!id.success) return res.status(400).json({ error: 'Id de partido inválido.' })
        const existing = this.service.getMatch(id.data, true)
        if (!existing) return res.status(404).json({ error: 'Partido no encontrado.' })
        if (existing.status !== 'SCHEDULED') return res.status(409).json({ error: 'Solo se puede editar un partido programado.' })
        const { match, errors } = this.service.buildInput(req.body)
        if (errors.length) return res.status(400).json({ error: errors.join(' ') })
        const updated = this.service.updateMatch(id.data, match)
        notify('updated', updated.id)
        res.json(updated)
    }

    deleteMatch: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id)
        if (!id.success) return res.status(400).json({ error: 'Id de partido inválido.' })
        if (!this.service.deleteMatch(id.data)) return res.status(404).json({ error: 'Partido no encontrado.' })
        notify('deleted', id.data)
        res.status(204).end()
    }

    setLineVisibility: RequestHandler = (req, res) => {
        const date = z.string().safeParse(req.params.date)
        if (!date.success || !this.service.validDate(date.data) || typeof req.body.visible !== 'boolean') return res.status(400).json({ error: 'Fecha o visibilidad inválida.' })
        this.service.setLineVisibility(date.data, req.body.visible)
        notify('line-visibility', date.data)
        res.json({ date: date.data, visible: req.body.visible })
    }

    startMatch = this.statusHandler('SCHEDULED', 'LIVE')
    finishMatch = this.statusHandler('LIVE', 'FINISHED')
    reopenMatch = this.statusHandler('FINISHED', 'LIVE')

    changeScore: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id), input = scoreSchema.safeParse(req.body)
        if (!id.success || !input.success) return res.status(400).json({ error: 'Cambio inválido.' })
        const updated = this.service.changeScore(id.data, input.data.team, input.data.delta)
        if (!updated) {
            const match = this.service.getMatch(id.data, true)
            return res.status(match ? 409 : 404).json({ error: match ? 'Marcador bloqueado o inválido.' : 'Partido no encontrado.' })
        }
        notify('score', updated.id)
        res.json(updated)
    }

    setResult: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id), input = resultSchema.safeParse(req.body)
        if (!id.success) return res.status(400).json({ error: 'Id de partido inválido.' })
        if (!input.success) return res.status(400).json({ error: 'El marcador debe usar enteros no negativos.' })
        const updated = this.service.setResult(id.data, input.data.scoreA, input.data.scoreB)
        if (!updated) {
            const match = this.service.getMatch(id.data, true)
            return res.status(match ? 409 : 404).json({ error: match ? 'Solo se puede corregir un partido finalizado.' : 'Partido no encontrado.' })
        }
        notify('result', updated.id)
        res.json(updated)
    }

    resetScore: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id)
        if (!id.success) return res.status(400).json({ error: 'Id de partido inválido.' })
        const updated = this.service.resetScore(id.data)
        if (!updated) {
            const match = this.service.getMatch(id.data, true)
            return res.status(match ? 409 : 404).json({ error: match ? 'Solo se puede reiniciar un partido en juego.' : 'Partido no encontrado.' })
        }
        notify('reset', updated.id)
        res.json(updated)
    }

    setCards: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id), input = cardsSchema.safeParse(req.body)
        if (!id.success) return res.status(400).json({ error: 'Id de partido inválido.' })
        if (!input.success) return res.status(400).json({ error: 'Las tarjetas deben ser enteros no negativos.' })
        const updated = this.service.setCards(id.data, input.data)
        if (!updated) return res.status(404).json({ error: 'Partido no encontrado.' })
        notify('cards', updated.id)
        res.json(updated)
    }

    getScoring: RequestHandler = (req, res) => {
        const matchId = idSchema.safeParse(req.params.matchId)
        if (!matchId.success) return res.status(400).json({ error: 'Id de partido inválido.' })
        if (!this.service.getMatch(matchId.data, true)) return res.status(404).json({ error: 'Partido no encontrado.' })
        res.json(this.service.getScoring(matchId.data))
    }

    insertScoring: RequestHandler = (req, res) => {
        const matchId = idSchema.safeParse(req.params.matchId), input = newScoringSchema.safeParse(req.body)
        if (!matchId.success) return res.status(400).json({ error: 'Id de partido inválido.' })
        if (!input.success) return res.status(400).json({ error: 'Anotación inválida.' })
        const match = this.service.getMatch(matchId.data, true)
        if (!match) return res.status(404).json({ error: 'Partido no encontrado.' })
        const player = this.playerService.getPlayer(input.data.playerId)
        if (!player) return res.status(404).json({ error: 'Jugador no encontrado.' })
        if (![match.teamAId, match.teamBId].includes(player.teamId)) return res.status(400).json({ error: 'El jugador no pertenece al partido.' })
        if (this.service.getPlayerScoring(match.id, player.id)) return res.status(409).json({ error: 'El jugador ya tiene goleo registrado.' })
        const created = this.service.insertScoring({ matchId: match.id, ...input.data })
        notify('scoring', match.id)
        res.status(201).json(created)
    }

    updateScoring: RequestHandler = (req, res) => {
        const matchId = idSchema.safeParse(req.params.matchId), playerId = idSchema.safeParse(req.params.playerId), input = scoringSchema.safeParse(req.body)
        if (!matchId.success || !playerId.success) return res.status(400).json({ error: 'Id inválido.' })
        if (!input.success) return res.status(400).json({ error: 'Anotación inválida.' })
        const match = this.service.getMatch(matchId.data, true)
        if (!match) return res.status(404).json({ error: 'Partido no encontrado.' })
        const player = this.playerService.getPlayer(playerId.data)
        if (!player) return res.status(404).json({ error: 'Jugador no encontrado.' })
        if (![match.teamAId, match.teamBId].includes(player.teamId)) return res.status(400).json({ error: 'El jugador no pertenece al partido.' })
        if (!this.service.getPlayerScoring(match.id, player.id)) return res.status(404).json({ error: 'Goleo no encontrado.' })
        const updated = this.service.updateScoring({ matchId: match.id, playerId: player.id, ...input.data })
        notify('scoring', match.id)
        res.json(updated)
    }

    deleteScoring: RequestHandler = (req, res) => {
        const matchId = idSchema.safeParse(req.params.matchId), playerId = idSchema.safeParse(req.params.playerId)
        if (!matchId.success || !playerId.success) return res.status(400).json({ error: 'Id inválido.' })
        const match = this.service.getMatch(matchId.data, true)
        if (!match) return res.status(404).json({ error: 'Partido no encontrado.' })
        const player = this.playerService.getPlayer(playerId.data)
        if (!player) return res.status(404).json({ error: 'Jugador no encontrado.' })
        if (![match.teamAId, match.teamBId].includes(player.teamId)) return res.status(400).json({ error: 'El jugador no pertenece al partido.' })
        if (!this.service.deleteScoring(matchId.data, playerId.data)) return res.status(404).json({ error: 'Goleo no encontrado.' })
        notify('scoring', matchId.data)
        res.status(204).end()
    }

    private statusHandler(from: string, to: string): RequestHandler {
        return (req, res) => {
            const id = idSchema.safeParse(req.params.id)
            if (!id.success) return res.status(400).json({ error: 'Id de partido inválido.' })
            const updated = this.service.changeStatus(id.data, from, to)
            if (!updated) {
                const match = this.service.getMatch(id.data, true)
                return res.status(match ? 409 : 404).json({ error: match ? `El partido debe estar ${from}.` : 'Partido no encontrado.' })
            }
            notify(to.toLowerCase(), updated.id)
            res.json(updated)
        }
    }
}
