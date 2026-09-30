import { RequestHandler } from "express";
import { z } from "zod";
import { DatabaseConnectionError } from "../db/db_connection";
import { GroupService } from "../service/group_service";
import { PhaseDetailService } from "../service/phase_detail_service";
import { PhaseService } from "../service/phase_service";
import { TeamService } from "../service/team_service";
import { notify } from "../utils/events";

const idSchema = z.coerce.number().int().positive();
const membershipSchema = z.object({ groupId: idSchema, teamId: idSchema });
const groupSchema = z.object({ groupId: idSchema });
const sanctionSchema = z.object({ reason: z.string().trim().min(1) });
const cardsSchema = z.object({ yellowCards: z.coerce.number().int().nonnegative(), redCards: z.coerce.number().int().nonnegative() }).refine(value => value.yellowCards + value.redCards > 0);
const scoringTableSchema = z.object({ name: z.string().trim().min(1).max(100) });
const ruleSchema = z.object({
    positions: z.array(z.coerce.number().int().positive()).min(1).optional(),
    startPosition: z.coerce.number().int().positive().optional(),
    endPosition: z.coerce.number().int().positive().optional(),
    label: z.string().trim().min(1),
}).superRefine((value, context) => {
    if (!value.positions && (!value.startPosition || !value.endPosition || value.endPosition < value.startPosition || value.endPosition - value.startPosition > 1000)) {
        context.addIssue({ code: 'custom', message: 'Rango inválido.' })
    }
}).transform(value => {
    const positions = [...new Set(value.positions || Array.from(
        { length: value.endPosition! - value.startPosition! + 1 },
        (_, index) => value.startPosition! + index,
    ))].sort((a, b) => a - b)
    return { startPosition: positions[0]!, endPosition: positions.at(-1)!, positions, label: value.label }
});

export class PhaseDetailController {
    constructor(
        private readonly service: PhaseDetailService,
        private readonly phaseService: PhaseService,
        private readonly groupService: GroupService,
        private readonly teamService: TeamService,
    ) {}

    getMemberships: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id)
        if (!phaseId.success) return res.status(400).json({ error: 'Id de fase inválido.' })
        res.json(this.service.getMemberships(phaseId.data))
    }

    insertMembership: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id), input = membershipSchema.safeParse(req.body)
        if (!phaseId.success || !input.success) return res.status(400).json({ error: 'Fase, grupo o equipo inválido.' })
        const phase = this.phaseService.getPhaseById(phaseId.data)
        const group = this.groupService.getGroup(input.data.groupId)
        const team = this.teamService.getTeam(input.data.teamId)
        if (!phase || !group || group.phaseId !== phase.id || !team || team.tournamentId !== phase.tournamentId) {
            return res.status(400).json({ error: 'Fase, grupo o equipo inválido.' })
        }
        try {
            res.status(201).json(this.service.insertMembership({ phaseId: phase.id, groupId: group.id, teamId: team.id }))
        } catch (error) {
            if (error instanceof DatabaseConnectionError && error.name === 'DuplicateMembershipError') return res.status(409).json({ error: error.message })
            throw error
        }
    }

    updateMembership: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id), teamId = idSchema.safeParse(req.params.teamId), input = groupSchema.safeParse(req.body)
        if (!phaseId.success || !teamId.success || !input.success) return res.status(400).json({ error: 'Grupo inválido.' })
        const group = this.groupService.getGroup(input.data.groupId)
        if (!group || group.phaseId !== phaseId.data) return res.status(400).json({ error: 'Grupo inválido.' })
        if (this.service.teamHasMatches(phaseId.data, teamId.data)) return res.status(409).json({ error: 'El equipo tiene partidos existentes.' })
        const updated = this.service.updateMembership(phaseId.data, teamId.data, group.id)
        if (!updated) return res.status(404).json({ error: 'Membresía no encontrada.' })
        res.json(updated)
    }

    deleteMembership: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id), teamId = idSchema.safeParse(req.params.teamId)
        if (!phaseId.success || !teamId.success) return res.status(400).json({ error: 'Id inválido.' })
        if (this.service.teamHasMatches(phaseId.data, teamId.data)) return res.status(409).json({ error: 'El equipo tiene partidos existentes.' })
        if (!this.service.deleteMembership(phaseId.data, teamId.data)) return res.status(404).json({ error: 'Membresía no encontrada.' })
        res.status(204).end()
    }

    getRules: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id)
        if (!phaseId.success) return res.status(400).json({ error: 'Id de fase inválido.' })
        res.json(this.service.getRules(phaseId.data))
    }

    insertRule: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id), rule = ruleSchema.safeParse(req.body)
        if (!phaseId.success) return res.status(400).json({ error: 'Id de fase inválido.' })
        if (!this.phaseService.getPhaseById(phaseId.data)) return res.status(404).json({ error: 'Fase no encontrada.' })
        if (!rule.success) return res.status(400).json({ error: 'Regla inválida.' })
        if (this.service.overlaps(phaseId.data, rule.data)) return res.status(409).json({ error: 'Una posición ya pertenece a otra regla.' })
        const created = this.service.insertRule(phaseId.data, rule.data)
        notify('classification-rules', phaseId.data)
        res.status(201).json(created)
    }

    updateRule: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id), ruleId = idSchema.safeParse(req.params.ruleId), input = ruleSchema.safeParse(req.body)
        if (!phaseId.success || !ruleId.success) return res.status(400).json({ error: 'Id inválido.' })
        const current = this.service.getRule(ruleId.data)
        if (!current || current.phaseId !== phaseId.data) return res.status(404).json({ error: 'Regla no encontrada.' })
        if (!input.success) return res.status(400).json({ error: 'Regla inválida.' })
        if (this.service.overlaps(phaseId.data, input.data, current.id)) return res.status(409).json({ error: 'Una posición ya pertenece a otra regla.' })
        const updated = this.service.updateRule(current.id, input.data)
        notify('classification-rules', current.phaseId)
        res.json(updated)
    }

    deleteRule: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id), ruleId = idSchema.safeParse(req.params.ruleId)
        if (!phaseId.success || !ruleId.success) return res.status(400).json({ error: 'Id inválido.' })
        if (!this.service.deleteRule(ruleId.data, phaseId.data)) return res.status(404).json({ error: 'Regla no encontrada.' })
        notify('classification-rules', phaseId.data)
        res.status(204).end()
    }

    getSanctions: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id)
        if (!phaseId.success) return res.status(400).json({ error: 'Id de fase inválido.' })
        res.json(this.service.getSanctions(phaseId.data))
    }

    upsertSanction: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id), teamId = idSchema.safeParse(req.params.teamId), input = sanctionSchema.safeParse(req.body)
        if (!phaseId.success || !teamId.success || !input.success) return res.status(400).json({ error: input.success ? 'Id inválido.' : 'El motivo es obligatorio.' })
        if (!this.service.hasMembership(phaseId.data, teamId.data)) return res.status(400).json({ error: 'El equipo no pertenece a la fase.' })
        const sanction = this.service.upsertSanction(phaseId.data, teamId.data, input.data.reason)
        notify('sanction', phaseId.data)
        res.json(sanction)
    }

    deleteSanction: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id), teamId = idSchema.safeParse(req.params.teamId)
        if (!phaseId.success || !teamId.success) return res.status(400).json({ error: 'Id inválido.' })
        if (!this.service.deleteSanction(phaseId.data, teamId.data)) return res.status(404).json({ error: 'Sanción no encontrada.' })
        notify('sanction', phaseId.data)
        res.status(204).end()
    }

    getTeamCards: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id)
        if (!phaseId.success) return res.status(400).json({ error: 'Id de fase inválido.' })
        res.json(this.service.getTeamCards(phaseId.data))
    }

    upsertTeamCards: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id), teamId = idSchema.safeParse(req.params.teamId), input = cardsSchema.safeParse(req.body)
        if (!phaseId.success || !teamId.success || !input.success) return res.status(400).json({ error: 'Las tarjetas deben ser enteros no negativos y al menos una debe ser mayor que cero.' })
        if (!this.service.hasMembership(phaseId.data, teamId.data)) return res.status(400).json({ error: 'El equipo no pertenece a la fase.' })
        const cards = this.service.upsertTeamCards({ phaseId: phaseId.data, teamId: teamId.data, ...input.data })
        notify('cards', phaseId.data)
        res.json(cards)
    }

    deleteTeamCards: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id), teamId = idSchema.safeParse(req.params.teamId)
        if (!phaseId.success || !teamId.success) return res.status(400).json({ error: 'Id inválido.' })
        if (!this.service.deleteTeamCards(phaseId.data, teamId.data)) return res.status(404).json({ error: 'Tarjetas no encontradas.' })
        notify('cards', phaseId.data)
        res.status(204).end()
    }

    getStandings: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id)
        if (!phaseId.success) return res.status(400).json({ error: 'Id de fase inválido.' })
        const standings = this.service.getStandings(phaseId.data)
        if (!standings) return res.status(404).json({ error: 'Fase no encontrada.' })
        res.json(standings)
    }

    getScoring: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id)
        if (!phaseId.success) return res.status(400).json({ error: 'Id de fase inválido.' })
        const scoring = this.service.getScoring(phaseId.data)
        if (!scoring) return res.status(404).json({ error: 'Fase no encontrada.' })
        res.json(scoring)
    }

    insertScoringTable: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id), input = scoringTableSchema.safeParse(req.body)
        if (!phaseId.success || !input.success) return res.status(400).json({ error: 'Tabla de goleo inválida.' })
        try {
            const created = this.service.insertScoringTable(phaseId.data, input.data.name)
            if (!created) return res.status(404).json({ error: 'Fase no encontrada.' })
            notify('scoring-table', phaseId.data)
            res.status(201).json(created)
        } catch (error) {
            if (error instanceof DatabaseConnectionError && error.name === 'UniqueConstraintError') return res.status(409).json({ error: 'Esa tabla de goleo ya existe.' })
            throw error
        }
    }

    updateScoringTable: RequestHandler = (req, res) => {
        const phaseId = idSchema.safeParse(req.params.id), tableId = idSchema.safeParse(req.params.tableId), input = scoringTableSchema.safeParse(req.body)
        if (!phaseId.success || !tableId.success || !input.success) return res.status(400).json({ error: 'Tabla de goleo inválida.' })
        try {
            const updated = this.service.updateScoringTable(phaseId.data, tableId.data, input.data.name)
            if (!updated) return res.status(404).json({ error: 'Tabla de goleo no encontrada.' })
            notify('scoring-table', phaseId.data)
            res.json(updated)
        } catch (error) {
            if (error instanceof DatabaseConnectionError && error.name === 'UniqueConstraintError') return res.status(409).json({ error: 'Esa tabla de goleo ya existe.' })
            throw error
        }
    }
}
