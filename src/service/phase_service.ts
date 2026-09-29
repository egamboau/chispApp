import { Phase } from "../models/phases";
import { PhaseRepository } from "../repository/phase_repository";

export class PhaseService {
    private phasesRepository: PhaseRepository;

    constructor(phaseRepository:PhaseRepository) {
        this.phasesRepository = phaseRepository
    }

    getPhaseByIdAndTournamentId(currentPhaseId: number, tournamentId: number): Phase | undefined {
        return this.phasesRepository.getPhaseByTournamentIdAndPhaseID(currentPhaseId, tournamentId)
    }

    getPhaseById(id: number): Phase | undefined {
        return this.phasesRepository.getPhaseById(id)
    }

    getPhasesForTournament(tournamentId: number): Phase[] {
        return this.phasesRepository.getPhasesForTournament(tournamentId)
    }

    insertPhase(phase: Omit<Phase, 'id'>): Phase | undefined {
        return this.phasesRepository.insertPhase(phase)
    }

    updatePhase(id: number, phase: Pick<Phase, 'name' | 'type' | 'tournamentType' | 'sortOrder'>): Phase | undefined {
        return this.phasesRepository.updatePhase(id, phase)
    }

    deletePhase(id: number): boolean {
        return this.phasesRepository.deletePhase(id)
    }
}
