export interface Tournament {

    id: number;
    name:string;
    active:number;
    currentPhaseId:number | null
    currentMalePhaseId:number | null
    currentFemalePhaseId:number | null
    legacyType:string
}
