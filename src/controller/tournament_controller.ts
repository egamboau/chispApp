
import { DatabaseConnectionError } from "../db/db_connection";
import { TournamentService } from "../service/tournament_service";
import { RequestHandler } from "express";
import { z } from "zod";
import { PhaseService } from "../service/phase_service";
import { notify } from "../utils/events";


const createTournamentSchema = z.object({
  name: z.string().trim().min(1, "Nombre es obligatorio").max(100, "El nombre es muy largo"),
  active: z.boolean().default(true),
});


const updateTournamentSchema = z.object({
  name: z.string().trim().min(1, "Nombre es obligatorio").max(100, "El nombre es muy largo"),
  currentPhaseId: z.number(),
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

        const validationResult = updateTournamentSchema.safeParse(req.body)
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

        const tournamentPhase = this.phaseService.getPhaseByIdAndTournamentId(validationResult.data.currentPhaseId, tournament.id)
        if(!tournamentPhase) {
            return res.status(400).json({
                error: 'La fase actual no pertenece al torneo.'
            });
        }

        const result = this.tournamentService.updateTournament(tournament.id, validationResult.data.name, validationResult.data.active, validationResult.data.currentPhaseId)
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
