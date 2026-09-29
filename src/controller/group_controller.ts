import { RequestHandler } from "express";
import { z } from "zod";
import { DatabaseConnectionError } from "../db/db_connection";
import { GroupService } from "../service/group_service";
import { PhaseService } from "../service/phase_service";

const idSchema = z.coerce.number().int().positive();
const createGroupSchema = z.object({ name: z.string().trim().min(1).max(100) });
const updateGroupSchema = z.object({ name: z.string().trim().min(1) });

export class GroupController {
    constructor(
        private readonly groupService: GroupService,
        private readonly phaseService: PhaseService,
    ) {}

    getGroupsForPhase: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id)
        if (!id.success) return res.status(400).json({ error: 'Id de fase inválido.' })

        res.json(this.groupService.getGroupsForPhase(id.data))
    }

    insertGroup: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id)
        if (!id.success) {
            return res.status(400).json({ error: 'Id de fase inválido.' })
        }
        if (!this.phaseService.getPhaseById(id.data)) {
            return res.status(404).json({ error: 'Fase no encontrada.' })
        }

        const group = createGroupSchema.safeParse(req.body)
        if (!group.success) return res.status(400).json({ error: 'Nombre de grupo inválido.' })

        res.status(201).json(this.groupService.insertGroup(id.data, group.data.name))
    }

    updateGroup: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id)
        const group = updateGroupSchema.safeParse(req.body)
        if (!id.success) {
            return res.status(400).json({ error: 'Id de grupo inválido.' })
        }
        if (!group.success){
            return res.status(400).json({ error: 'Nombre de grupo inválido.' })
        }

        const updated = this.groupService.updateGroup(id.data, group.data.name)
        if (!updated) {
            return res.status(404).json({ error: 'Grupo no encontrado.' })
        }
        res.json(updated)
    }

    deleteGroup: RequestHandler = (req, res) => {
        const id = idSchema.safeParse(req.params.id)
        if (!id.success) return res.status(400).json({ error: 'Id de grupo inválido.' })

        try {
            if (!this.groupService.deleteGroup(id.data)) {
                return res.status(404).json({ error: 'Grupo no encontrado.' })
            }
            res.status(204).end()
        } catch (error) {
            if (error instanceof DatabaseConnectionError) {
                return res.status(409).json({ error: 'No se puede eliminar: grupo tiene datos asociados.' })
            }
            throw error
        }
    }
}
