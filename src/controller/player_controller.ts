import { RequestHandler } from "express";
import { z } from "zod";
import { DatabaseConnectionError } from "../db/db_connection";
import { PlayerService } from "../service/player_service";
import { TeamService } from "../service/team_service";

const idSchema = z.coerce.number().int().positive();
const playerSchema = z.object({
    number: z.string().trim().regex(/^\d+$/),
    name: z.preprocess(value => value ?? '', z.string().trim().max(100)).transform(value => value || null),
});
const statusSchema = z.object({ status: z.enum(['REGISTERED', 'UNREGISTERED']) });

export class PlayerController {
    constructor(
        private readonly playerService: PlayerService,
        private readonly teamService: TeamService,
    ) {}

    getPlayersForTeam: RequestHandler = (req, res) => {
        const teamId = idSchema.safeParse(req.params.teamId)
        if (!teamId.success) return res.status(400).json({ error: 'Id de equipo inválido.' })
        if (!this.teamService.getTeam(teamId.data)) return res.status(404).json({ error: 'Equipo no encontrado.' })
        res.json(this.playerService.getPlayersForTeam(teamId.data))
    }

    insertPlayer: RequestHandler = (req, res) => {
        const teamId = idSchema.safeParse(req.params.teamId), input = playerSchema.safeParse(req.body)
        if (!teamId.success) return res.status(400).json({ error: 'Id de equipo inválido.' })
        if (!this.teamService.getTeam(teamId.data)) return res.status(404).json({ error: 'Equipo no encontrado.' })
        if (!input.success) return res.status(400).json({ error: 'Jugador inválido.' })
        try {
            res.status(201).json(this.playerService.insertPlayer(teamId.data, input.data.number, input.data.name))
        } catch (error) {
            if (error instanceof DatabaseConnectionError && error.name === 'DuplicatePlayerError') return res.status(409).json({ error: error.message })
            throw error
        }
    }

    updatePlayer: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id), input = playerSchema.safeParse(req.body)
        if (!id.success) return res.status(400).json({ error: 'Id de jugador inválido.' })
        if (!this.playerService.getPlayer(id.data)) return res.status(404).json({ error: 'Jugador no encontrado.' })
        if (!input.success) return res.status(400).json({ error: 'Jugador inválido.' })
        try {
            res.json(this.playerService.updatePlayer(id.data, input.data.number, input.data.name))
        } catch (error) {
            if (error instanceof DatabaseConnectionError && error.name === 'DuplicatePlayerError') return res.status(409).json({ error: error.message })
            throw error
        }
    }

    updateStatus: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id), input = statusSchema.safeParse(req.body)
        if (!id.success) return res.status(400).json({ error: 'Id de jugador inválido.' })
        if (!input.success) return res.status(400).json({ error: 'Estado inválido.' })
        const player = this.playerService.updateStatus(id.data, input.data.status)
        if (!player) return res.status(404).json({ error: 'Jugador no encontrado.' })
        res.json(player)
    }
}
