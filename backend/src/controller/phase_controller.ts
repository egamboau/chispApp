import { RequestHandler } from "express";
import { PhaseService } from "../service/phase_service";
import { TournamentService } from "../service/tournament_service";
import { DatabaseConnectionError } from "../db/db_connection";
import { notify } from "../utils/events";
import { z } from "zod";

const idSchema = z.coerce.number().int().positive();
const phaseTypeSchema = z.enum(['TABLE', 'ELIMINATION']);
const tournamentTypeSchema = z.enum(['MALE', 'FEMALE']);
const createPhaseSchema = z.object({
    name: z.string().trim().min(1).max(100),
    type: z.preprocess(value => value || undefined, phaseTypeSchema.default('TABLE')),
    tournamentType: tournamentTypeSchema.optional(),
    sortOrder: z.preprocess(value => value || undefined, z.coerce.number().int().positive().default(1)),
});
const updatePhaseSchema = z.object({
    name: z.string().trim().min(1).max(100),
    type: phaseTypeSchema,
    tournamentType: tournamentTypeSchema.optional(),
    sortOrder: z.coerce.number().int().positive(),
});

export class PhaseController {
    private phaseService: PhaseService;
    private tournamentService: TournamentService;

    constructor (phaseService: PhaseService, tournamentService: TournamentService) {
        this.phaseService = phaseService
        this.tournamentService = tournamentService
    }

    getPhasesForTournament: RequestHandler = (req, res) => {
        const idResult = idSchema.safeParse(req.params.id)
        if (!idResult.success) {
            return res.status(400).json({ error: "Id de torneo inválido." })
        }

        res.json(this.phaseService.getPhasesForTournament(idResult.data))
    }

    insertPhase: RequestHandler = (req, res) => {
        const idResult = idSchema.safeParse(req.params.id)
        if (!idResult.success) {
            return res.status(400).json({ error: 'Id de torneo inválido.' })
        }

        const tournament = this.tournamentService.getTournamentById(idResult.data)
        if (!tournament) {
            return res.status(404).json({ error: 'Torneo no encontrado.' })
        }

        const result = createPhaseSchema.safeParse(req.body)
        if (!result.success) {
            return res.status(400).json({ error: 'Datos de fase inválidos.' })
        }

        const tournamentType = result.data.tournamentType || tournament.legacyType || (tournament.id % 2 ? 'MALE' : 'FEMALE')

        res.status(201).json(this.phaseService.insertPhase({
            tournamentId: tournament.id,
            ...result.data,
            tournamentType,
        }))
    }

    updatePhase: RequestHandler = (req, res) => {
        const idResult = idSchema.safeParse(req.params.id)
        if (!idResult.success) {
            return res.status(400).json({ error: 'Id de fase inválido.' })
        }

        const phase = this.phaseService.getPhaseById(idResult.data)
        if (!phase) {
            return res.status(404).json({ error: 'Fase no encontrada.' })
        }

        const result = updatePhaseSchema.safeParse(req.body)
        if (!result.success) {
            return res.status(400).json({ error: 'Datos de fase inválidos.' })
        }

        const updated = this.phaseService.updatePhase(phase.id, {
            ...result.data,
            tournamentType: result.data.tournamentType || phase.tournamentType,
        })
        notify('phase', phase.id)
        res.json(updated)
    }

    deletePhase: RequestHandler = (req, res) => {
        const idResult = idSchema.safeParse(req.params.id)
        if (!idResult.success) return res.status(400).json({ error: 'Id de fase inválido.' })

        try {
            if (!this.phaseService.deletePhase(idResult.data)) {
                return res.status(404).json({ error: 'Fase no encontrada.' })
            }
            res.status(204).end()
        } catch (error) {
            if (error instanceof DatabaseConnectionError) {
                return res.status(409).json({ error: error.message })
            }
            res.status(500).json({ error: 'Internal Server error' })
        }
    }
}
