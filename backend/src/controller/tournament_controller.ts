
import { DatabaseConnectionError } from "../db/db_connection";
import { TournamentService } from "../service/tournament_service";
import { RequestHandler } from "express";
import { z } from "zod";
import { UpdateTournamentInputSchema } from '@jupas/shared';
import { PhaseService } from "../service/phase_service";
import { notify } from "../utils/events";


const createTournamentSchema = z.object({
  name: z.string().trim().min(1, "Nombre es obligatorio").max(100, "El nombre es muy largo"),
  active: z.boolean().default(true),
});


export class TournamentController {
    private tournamentService:TournamentService
    private phaseService: PhaseService;

    constructor(tournamentService:TournamentService, phaseService:PhaseService) {
        this.tournamentService = tournamentService
        this.phaseService = phaseService
    }

    getTournaments: RequestHandler = (req, res) => {
        const isAdmin = Boolean((req as typeof req & { isAdmin?: boolean }).isAdmin)
        res.json(this.tournamentService.getAllTournaments(!isAdmin || req.query.active === 'true'))
    }

    insertTournament: RequestHandler = (req, res) => {
        const result = createTournamentSchema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({
                error: result.error.issues[0]?.message ??"Datos de torneo inválidos.",
            });
        }
        try {
            res.status(201).json(this.tournamentService.insertTournament(result.data.name, result.data.active))
        } catch (error) {
            if(error instanceof DatabaseConnectionError) {
                return res.status(409).json({ error: error.message });
            } else {
                res.status(500).json({error: "Internal Server error"})
            }
        }

    }

    getTournamentById: RequestHandler = (req, res) => {
        const idResult = z.coerce.number().int().positive().safeParse(req.params.id)
        if (!idResult.success) {
            return res.status(400).json({ error: "Id de torneo inválido." })
        }

        const validationResult = UpdateTournamentInputSchema.safeParse(req.body)
        if(!validationResult.success) {
            return res.status(400).json({
                error: validationResult.error.issues[0]?.message ?? "Datos de torneo inválidos.",
            });
        }

        const tournament = this.tournamentService.getTournamentById(idResult.data)
        if(!tournament) {
            return res.status(404).json({
                error: 'Torneo no encontrado.'
            });
        }

        const input = validationResult.data;
        let male = input.currentMalePhaseId === undefined ? tournament.currentMalePhaseId : input.currentMalePhaseId;
        let female = input.currentFemalePhaseId === undefined ? tournament.currentFemalePhaseId : input.currentFemalePhaseId;
        if (input.currentPhaseId !== undefined) {
            const legacyPhase = this.phaseService.getPhaseByIdAndTournamentId(input.currentPhaseId, tournament.id);
            if (!legacyPhase) return res.status(400).json({ error: 'La fase actual no pertenece al torneo.' });
            if (legacyPhase.tournamentType === 'MALE') male = legacyPhase.id;
            else female = legacyPhase.id;
        }
        for (const [id, category] of [[male, 'MALE'], [female, 'FEMALE']] as const) {
            if (id === null) continue;
            const phase = this.phaseService.getPhaseByIdAndTournamentId(id, tournament.id);
            if (!phase || phase.tournamentType !== category) return res.status(400).json({ error: 'La fase actual debe pertenecer al torneo y categoría indicados.' });
        }
        const legacy = input.currentPhaseId ?? ([male, female].includes(tournament.currentPhaseId) ? tournament.currentPhaseId : male ?? female);
        const result = this.tournamentService.updateTournament(tournament.id, input.name, input.active, male, female, legacy);
        notify('tournament', tournament.id);
        res.json(result);
        };

    deleteTournamentById: RequestHandler = (req, res) => {
        const idResult = z.coerce.number().int().positive().safeParse(req.params.id)
        if (!idResult.success) {
            return res.status(400).json({ error: "Id de torneo inválido." })
        }
        try {
            const result = this.tournamentService.deleteTournamentById(idResult.data)
            if (!result) {
                return res.status(404).json({ error: "Torneo no encontrado." })
            }
            res.status(204).end()
        } catch (error) {
            if(error instanceof DatabaseConnectionError && error.name === "ConstrainError") {
                return res.status(409).json({ error: "No se puede eliminar Torneo, tiene datos asociados" });
            } else {
                res.status(500).json({error: "Internal Server error"})
            }
        }
    }
}
