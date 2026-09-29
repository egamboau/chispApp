import { RequestHandler } from "express";
import { z } from "zod";
import { DatabaseConnectionError } from "../db/db_connection";
import { TeamService } from "../service/team_service";
import { TournamentService } from "../service/tournament_service";
import { notify } from "../utils/events";

const idSchema = z.coerce.number().int().positive();
const tournamentTypeSchema = z.enum(['MALE', 'FEMALE']);
const teamSchema = z.object({ name: z.string().trim().min(1).max(100) });

export class TeamController {
    constructor(
        private readonly teamService: TeamService,
        private readonly tournamentService: TournamentService,
    ) {}

    getTeams: RequestHandler = (req, res) => {
        const type = req.query.tournamentType
        if (type && !tournamentTypeSchema.safeParse(type).success) return res.status(400).json({ error: 'Torneo inválido.' })
        const tournamentId = idSchema.safeParse(req.query.tournamentId)
        if (tournamentId.success) return res.json(this.teamService.getTeamByTournament(tournamentId.data))
        if (typeof type === 'string') return res.json(this.teamService.getTeamByTournamentType(type))
        res.json(this.teamService.getTeams())
    }

    insertTeam: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.body.tournamentId)
        const type = tournamentTypeSchema.safeParse(req.body.tournamentType)
        const tournament = id.success
            ? this.tournamentService.getTournamentById(id.data)
            : type.success ? this.tournamentService.getTournamentByLegacyType(type.data) : undefined
        if (!tournament) return res.status(400).json({ error: 'Torneo inválido.' })

        const input = teamSchema.safeParse(req.body)
        if (!input.success) return res.status(400).json({ error: 'Nombre de equipo inválido.' })

        try {
            const tournamentType = tournament.legacyType || (tournament.id % 2 ? 'MALE' : 'FEMALE')
            res.status(201).json(this.teamService.insertTeam(tournamentType, tournament.id, input.data.name))
        } catch (error) {
            if (error instanceof DatabaseConnectionError && error.name === 'DuplicateTeamError') return res.status(409).json({ error: error.message })
            throw error
        }
    }

    updateTeam: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id)
        if (!id.success) return res.status(400).json({ error: 'Id de equipo inválido.' })
        if (!this.teamService.getTeam(id.data)) return res.status(404).json({ error: 'Equipo no encontrado.' })

        const input = teamSchema.safeParse(req.body)
        if (!input.success) return res.status(400).json({ error: 'Nombre de equipo inválido.' })

        try {
            const updated = this.teamService.updateTeam(id.data, input.data.name)
            notify('team', id.data)
            res.json(updated)
        } catch (error) {
            if (error instanceof DatabaseConnectionError && error.name === 'DuplicateTeamError') return res.status(409).json({ error: error.message })
            throw error
        }
    }

    deleteTeam: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id)
        if (!id.success) return res.status(400).json({ error: 'Id de equipo inválido.' })
        try {
            if (!this.teamService.deleteTeam(id.data)) return res.status(404).json({ error: 'Equipo no encontrado.' })
            res.status(204).end()
        } catch (error) {
            if (error instanceof DatabaseConnectionError) return res.status(409).json({ error: 'No se puede eliminar: equipo tiene datos asociados.' })
            throw error
        }
    }
}
