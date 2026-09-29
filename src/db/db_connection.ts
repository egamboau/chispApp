import path from "path";
import fs from "fs"
import Database from "better-sqlite3";
import {Phase} from "../models/phases"
import { Match } from "../models/match";
import { Tournament } from "../models/tournament";
import { Group } from "../models/group";
import { Team } from "../models/team";

export class DatabaseConnectionError extends Error {
    constructor(name:string, message:string, cause: unknown) {
        super(message, { cause });
        this.name = name;
    }
}

class DBConnection {
    getTournamentByLegacyType(legacyType: string): Tournament | undefined {
        return this.database.prepare<[string], Tournament>('SELECT * FROM tournaments WHERE legacyType=?').get(legacyType)

    }
    updateTeam(id: number, name: string) {
        this.database.transaction(() => {
                this.database.prepare('UPDATE teams SET name=? WHERE id=?').run(name, id)
                this.database.prepare('UPDATE matches SET teamA=?,updatedAt=CURRENT_TIMESTAMP WHERE teamAId=?').run(name, id)
                this.database.prepare('UPDATE matches SET teamB=?,updatedAt=CURRENT_TIMESTAMP WHERE teamBId=?').run(name, id)
                this.database.prepare('UPDATE matches SET lineTeam=?,updatedAt=CURRENT_TIMESTAMP WHERE lineTeamId=?').run(name, id)
            })()
    }
    insertTeam(tournamentType: string, tournamentId: number, name: string): Team | undefined {
        const result = this.database.prepare('INSERT INTO teams(tournamentType,tournamentId,name) VALUES(?,?,?)').run(tournamentType, tournamentId, name)
        return this.fetchOneElementFromTable<Team>('teams', result.lastInsertRowid)
    }
    getAllTeams(): Team[] {
        return this.database.prepare<[], Team>('SELECT * FROM teams ORDER BY name').all()
    }
    getTeamsByTournamentType(tournamentType: string): Team[] {
        return this.database.prepare<[string], Team>('SELECT * FROM teams WHERE tournamentType=? ORDER BY name').all(tournamentType)
    }
    getTeamsByTournament(tournamentId: number): Team[] {
        return this.database.prepare<[number], Team>('SELECT * FROM teams WHERE tournamentId=? ORDER BY name').all(tournamentId)
    }

    private readonly database: Database.Database

    constructor(dbPath:string) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        this.database = new Database(dbPath);
        this.database.pragma('foreign_keys = ON');

        this.initializeDatabaseSchema()
    }

    private initializeDatabaseSchema() {
        const matchesSchema = `CREATE TABLE IF NOT EXISTS matches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tournamentType TEXT NOT NULL CHECK (tournamentType IN ('MALE', 'FEMALE')),
          date TEXT NOT NULL, jornada TEXT NOT NULL CHECK (jornada IN ('MORNING', 'AFTERNOON')),
          teamA TEXT NOT NULL, teamB TEXT NOT NULL, lineTeam TEXT NOT NULL,
          court INTEGER NOT NULL CHECK (court > 0), scoreA INTEGER NOT NULL DEFAULT 0 CHECK (scoreA >= 0),
          scoreB INTEGER NOT NULL DEFAULT 0 CHECK (scoreB >= 0),
          status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'LIVE', 'FINISHED')),
          createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`;

        this.database.exec(matchesSchema);
        const hasTmeColumn = this.database.prepare<[], { name: string }>('PRAGMA table_info(matches)').all().some(({ name }) => name === 'time')
        if (hasTmeColumn) {
            this.database.transaction(() => {
                this.database.exec('ALTER TABLE matches RENAME TO matches_with_time');
                this.database.exec(matchesSchema);
                this.database.exec(`INSERT INTO matches (id,tournamentType,date,jornada,teamA,teamB,lineTeam,court,scoreA,scoreB,status,createdAt,updatedAt)
                    SELECT id,tournamentType,date,CASE WHEN time<'12:00' THEN 'MORNING' ELSE 'AFTERNOON' END,teamA,teamB,lineTeam,court,scoreA,scoreB,status,createdAt,updatedAt FROM matches_with_time`);
                    this.database.exec('DROP TABLE matches_with_time');
            })();
        }

        const oldScoringTables = this.database.prepare<[], { name: string }>('PRAGMA table_info(scoring_tables)').all()
        if (oldScoringTables.length && !oldScoringTables.some(({ name }) => name === 'tournamentId')) {
            this.database.transaction(() => {
                this.database.exec('DROP TRIGGER IF EXISTS scoring_table_insert; DROP TRIGGER IF EXISTS scoring_table_update; DROP TRIGGER IF EXISTS match_scoring_table_type_update;')
                this.database.exec('ALTER TABLE scoring_tables RENAME TO scoring_tables_by_type')
                this.database.exec("CREATE TABLE scoring_tables (id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentId INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,tournamentType TEXT NOT NULL CHECK(tournamentType IN('MALE','FEMALE')),name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) BETWEEN 1 AND 100),UNIQUE(tournamentId,tournamentType,name))")
            })()
        }

        this.database.exec(`
        CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentType TEXT NOT NULL CHECK(tournamentType IN ('MALE','FEMALE')),name TEXT NOT NULL COLLATE NOCASE CHECK(length(name) BETWEEN 1 AND 100),UNIQUE(tournamentType,name));
        INSERT OR IGNORE INTO teams(tournamentType,name) SELECT tournamentType,teamA FROM matches UNION SELECT tournamentType,teamB FROM matches UNION SELECT tournamentType,lineTeam FROM matches;
        CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT,teamId INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,number TEXT NOT NULL CHECK(length(number)>0 AND number NOT GLOB '*[^0-9]*'),name TEXT CHECK(name IS NULL OR length(name) BETWEEN 1 AND 100),status TEXT NOT NULL DEFAULT 'REGISTERED' CHECK(status IN('REGISTERED','UNREGISTERED')),UNIQUE(teamId,number));
        CREATE TABLE IF NOT EXISTS match_player_scoring (matchId INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,playerId INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,directGoals INTEGER NOT NULL DEFAULT 0 CHECK(directGoals>=0),horquetas INTEGER NOT NULL DEFAULT 0 CHECK(horquetas>=0),pepitas INTEGER NOT NULL DEFAULT 0 CHECK(pepitas>=0),scoringTable TEXT NOT NULL DEFAULT 'Torneo Regular' CHECK(length(trim(scoringTable)) BETWEEN 1 AND 100),total INTEGER GENERATED ALWAYS AS(directGoals+pepitas*2+horquetas*3) VIRTUAL,CHECK(directGoals+horquetas+pepitas>0),PRIMARY KEY(matchId,playerId));
        CREATE TABLE IF NOT EXISTS scoring_tables (id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentId INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,tournamentType TEXT NOT NULL CHECK(tournamentType IN('MALE','FEMALE')),name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) BETWEEN 1 AND 100),UNIQUE(tournamentId,tournamentType,name));
        CREATE TABLE IF NOT EXISTS tournaments (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 1 AND 100),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),currentPhaseId INTEGER,legacyType TEXT UNIQUE CHECK(legacyType IN('MALE','FEMALE')));
        CREATE TABLE IF NOT EXISTS phases (id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentId INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),type TEXT NOT NULL DEFAULT 'TABLE' CHECK(type IN('TABLE','ELIMINATION')),tournamentType TEXT CHECK(tournamentType IN('MALE','FEMALE')),sortOrder INTEGER NOT NULL DEFAULT 1 CHECK(sortOrder>0),UNIQUE(tournamentId,name));
        CREATE TABLE IF NOT EXISTS groups_table (id INTEGER PRIMARY KEY AUTOINCREMENT,phaseId INTEGER NOT NULL REFERENCES phases(id) ON DELETE RESTRICT,name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),UNIQUE(phaseId,name));
        CREATE TABLE IF NOT EXISTS phase_memberships (phaseId INTEGER NOT NULL REFERENCES phases(id) ON DELETE RESTRICT,groupId INTEGER NOT NULL REFERENCES groups_table(id) ON DELETE RESTRICT,teamId INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,PRIMARY KEY(phaseId,teamId));
        CREATE TABLE IF NOT EXISTS sanctions (phaseId INTEGER NOT NULL REFERENCES phases(id) ON DELETE RESTRICT,teamId INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,reason TEXT NOT NULL CHECK(length(trim(reason))>0),PRIMARY KEY(phaseId,teamId));
        CREATE TABLE IF NOT EXISTS published_line_dates (date TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS classification_rules (id INTEGER PRIMARY KEY AUTOINCREMENT,phaseId INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,startPosition INTEGER NOT NULL CHECK(startPosition>0),endPosition INTEGER NOT NULL CHECK(endPosition>=startPosition),label TEXT NOT NULL CHECK(length(trim(label))>0));`);


        this.addColumn('teams', 'tournamentId INTEGER REFERENCES tournaments(id)');
        this.addColumn('classification_rules', 'positions TEXT');
        this.addColumn('phases', "tournamentType TEXT CHECK(tournamentType IN('MALE','FEMALE'))");
        this.addColumn('match_player_scoring', "scoringTable TEXT NOT NULL DEFAULT 'Torneo Regular' CHECK(length(trim(scoringTable)) BETWEEN 1 AND 100)");
        for (const definition of [
            'phaseId INTEGER REFERENCES phases(id)',
            'groupId INTEGER REFERENCES groups_table(id)',
            'teamAId INTEGER REFERENCES teams(id)',
            'teamBId INTEGER REFERENCES teams(id)',
            'lineTeamId INTEGER REFERENCES teams(id)',
            'yellowCardsA INTEGER NOT NULL DEFAULT 0 CHECK(yellowCardsA>=0)',
            'redCardsA INTEGER NOT NULL DEFAULT 0 CHECK(redCardsA>=0)',
            'yellowCardsB INTEGER NOT NULL DEFAULT 0 CHECK(yellowCardsB>=0)',
            'redCardsB INTEGER NOT NULL DEFAULT 0 CHECK(redCardsB>=0)']) {
                this.addColumn('matches', definition)
            };
        this.database.exec(`
        CREATE TRIGGER IF NOT EXISTS match_player_scoring_team_insert BEFORE INSERT ON match_player_scoring WHEN NOT EXISTS(SELECT 1 FROM players p JOIN matches m ON m.id=NEW.matchId WHERE p.id=NEW.playerId AND p.teamId IN(m.teamAId,m.teamBId)) BEGIN SELECT RAISE(ABORT,'Player does not belong to this match'); END;
        CREATE TRIGGER IF NOT EXISTS match_player_scoring_team_update BEFORE UPDATE OF matchId,playerId ON match_player_scoring WHEN NOT EXISTS(SELECT 1 FROM players p JOIN matches m ON m.id=NEW.matchId WHERE p.id=NEW.playerId AND p.teamId IN(m.teamAId,m.teamBId)) BEGIN SELECT RAISE(ABORT,'Player does not belong to this match'); END;
        CREATE TRIGGER IF NOT EXISTS match_scoring_teams_update BEFORE UPDATE OF teamAId,teamBId ON matches WHEN EXISTS(SELECT 1 FROM match_player_scoring s JOIN players p ON p.id=s.playerId WHERE s.matchId=OLD.id AND p.teamId IS NOT NEW.teamAId AND p.teamId IS NOT NEW.teamBId) BEGIN SELECT RAISE(ABORT,'Match has scoring for another team'); END;
        CREATE TRIGGER IF NOT EXISTS player_scoring_team_update BEFORE UPDATE OF teamId ON players WHEN EXISTS(SELECT 1 FROM match_player_scoring s JOIN matches m ON m.id=s.matchId WHERE s.playerId=OLD.id AND NEW.teamId IS NOT m.teamAId AND NEW.teamId IS NOT m.teamBId) BEGIN SELECT RAISE(ABORT,'Player has scoring for another team'); END;`);
        const legacyType = (tournament:Tournament) => tournament.legacyType || (tournament.id % 2 ? 'MALE' : 'FEMALE');
        this.database.transaction(() => {
          for (const phase of this.database.prepare<[], Phase>('SELECT * FROM phases WHERE tournamentType IS NULL').all()) {
            const match = this.database.prepare<[number], Match>('SELECT tournamentType FROM matches WHERE phaseId=? GROUP BY tournamentType ORDER BY COUNT(*) DESC LIMIT 1').get(phase.id);
            const tournament = this.database.prepare<[number], Tournament>('SELECT * FROM tournaments WHERE id=?').get(phase.tournamentId);
            if (tournament) {
                this.database.prepare('UPDATE phases SET tournamentType=? WHERE id=?').run(match?.tournamentType || legacyType(tournament), phase.id);
            }
          }
          this.database.exec('UPDATE matches SET tournamentType=(SELECT tournamentType FROM phases WHERE phases.id=matches.phaseId) WHERE phaseId IS NOT NULL AND tournamentType<>(SELECT tournamentType FROM phases WHERE phases.id=matches.phaseId)');
        })();
        const legacyScoringTables = Boolean(this.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scoring_tables_by_type'").get())
        const needsScoringTableMigration = !this.database.prepare('SELECT 1 FROM scoring_tables LIMIT 1').get()
            && !(legacyScoringTables && this.database.prepare('SELECT 1 FROM scoring_tables_by_type LIMIT 1').get())
        this.database.transaction(() => {
            if (needsScoringTableMigration) this.database.exec("UPDATE match_player_scoring SET scoringTable='Torneo Regular' WHERE scoringTable='General';")
            if (legacyScoringTables) this.database.exec(`INSERT OR IGNORE INTO scoring_tables(tournamentId,tournamentType,name)
                SELECT DISTINCT p.tournamentId,l.tournamentType,l.name FROM scoring_tables_by_type l JOIN phases p ON p.tournamentType=l.tournamentType`)
            this.database.exec(`INSERT OR IGNORE INTO scoring_tables(tournamentId,tournamentType,name)
                SELECT DISTINCT tournamentId,tournamentType,'Torneo Regular' FROM phases WHERE tournamentType IS NOT NULL`)
            this.database.exec(`INSERT OR IGNORE INTO scoring_tables(tournamentId,tournamentType,name)
                SELECT DISTINCT p.tournamentId,m.tournamentType,s.scoringTable FROM match_player_scoring s JOIN matches m ON m.id=s.matchId JOIN phases p ON p.id=m.phaseId`)
            if (legacyScoringTables) this.database.exec('DROP TABLE scoring_tables_by_type')
        })()
        this.database.exec(`
        CREATE TRIGGER IF NOT EXISTS scoring_table_insert AFTER INSERT ON match_player_scoring BEGIN INSERT OR IGNORE INTO scoring_tables(tournamentId,tournamentType,name) SELECT p.tournamentId,m.tournamentType,NEW.scoringTable FROM matches m JOIN phases p ON p.id=m.phaseId WHERE m.id=NEW.matchId; END;
        CREATE TRIGGER IF NOT EXISTS scoring_table_update AFTER UPDATE OF scoringTable ON match_player_scoring BEGIN INSERT OR IGNORE INTO scoring_tables(tournamentId,tournamentType,name) SELECT p.tournamentId,m.tournamentType,NEW.scoringTable FROM matches m JOIN phases p ON p.id=m.phaseId WHERE m.id=NEW.matchId; END;
        CREATE TRIGGER IF NOT EXISTS match_scoring_table_type_update AFTER UPDATE OF tournamentType,phaseId ON matches BEGIN INSERT OR IGNORE INTO scoring_tables(tournamentId,tournamentType,name) SELECT p.tournamentId,NEW.tournamentType,scoringTable FROM match_player_scoring JOIN phases p ON p.id=NEW.phaseId WHERE matchId=NEW.id; END;
        CREATE TRIGGER IF NOT EXISTS phase_scoring_table_insert AFTER INSERT ON phases WHEN NEW.tournamentType IS NOT NULL BEGIN INSERT OR IGNORE INTO scoring_tables(tournamentId,tournamentType,name) VALUES(NEW.tournamentId,NEW.tournamentType,'Torneo Regular'); END;
        CREATE TRIGGER IF NOT EXISTS phase_scoring_table_update AFTER UPDATE OF tournamentId,tournamentType ON phases WHEN NEW.tournamentType IS NOT NULL BEGIN INSERT OR IGNORE INTO scoring_tables(tournamentId,tournamentType,name) VALUES(NEW.tournamentId,NEW.tournamentType,'Torneo Regular'); END;`)
    }

    private addColumn(table:string, definition:string) {
        const hasDefinition = this.database.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all().some(({ name }) => name === definition.split(/\s+/)[0])
        if (!hasDefinition){{
            this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
        }};
    }

    fetchOneElementFromTable<T>(table:string, value:number|bigint):T|undefined {
        return this.database.prepare<[number|bigint], T>(`SELECT * FROM ${table} WHERE id=?`).get(value);
    }

    fetchAllFromQuery<T>(query: string): T[] {
        return this.database.prepare<[], T>(query).all()
    }

    fetchOneFromQuery<T>(query: string, ...params: unknown[]): T | undefined {
        return this.database.prepare<unknown[], T>(query).get(...params)
    }

    fetchAllFromParameterizedQuery<T>(query: string, ...params: unknown[]): T[] {
        return this.database.prepare<unknown[], T>(query).all(...params)
    }

    fetchAllFromNamedQuery<T>(query: string, params: Record<string, string | number>): T[] {
        return this.database.prepare<Record<string, string | number>, T>(query).all(params)
    }

    executeQuery(query: string, ...params: unknown[]): Database.RunResult {
        try {
            return this.database.prepare<unknown[]>(query).run(...params)
        } catch (error) {
            this.throwDatabaseError(error)
        }
    }

    executeNamedQuery(query: string, params: object): Database.RunResult {
        return this.database.prepare<object>(query).run(params)
    }

    transaction<T>(action: () => T): T {
        return this.database.transaction(action)()
    }

    private throwDatabaseError(error: unknown): never {
        if (error instanceof Database.SqliteError) {
            const name = error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'UniqueConstraintError' : 'DatabaseError'
            throw new DatabaseConnectionError(name, 'Error al ejecutar la operación en la base de datos.', error)
        }
        throw error
    }

    insertTournamentInDatabase(name: string, active: boolean): Tournament|undefined {
        try {
            const result = this.database.prepare('INSERT INTO tournaments(name,active) VALUES(?,?)').run(name, active === false ? 0 : 1);
            return this.fetchOneElementFromTable('tournaments', result.lastInsertRowid);
        } catch (error) {
            if (error instanceof Database.SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE'){
                const toThrow = new DatabaseConnectionError("DuplicateTournamentError", "Ese torneo ya existe.", error)
                throw toThrow;
            }
            throw error
        }
    }

    fetchPhaseByTournamentAndPhaseId(currentPhaseId: number, tournamentId: number): Phase | undefined {
        return this.database.prepare<[number, number], Phase>('SELECT * FROM phases WHERE id=? AND tournamentId=?').get(currentPhaseId, tournamentId)
    }

    updateTournament(tournamentId: number, name: string, active: boolean, currentPhaseId: number): Tournament|undefined{
        this.database.prepare('UPDATE tournaments SET name=?,active=?,currentPhaseId=? WHERE id=?').run(name, active === false ? 0 : 1, currentPhaseId, tournamentId);
        return this.fetchOneElementFromTable('tournaments', tournamentId);
    }

    guardedDelete(table: string, id: number): boolean {
        var result = false
        try {
            const deleteResult = this.database.prepare(`DELETE FROM ${table} WHERE id=?`).run(id)
            result = deleteResult.changes > 0
        } catch (error) {
            if (error instanceof Database.SqliteError && error.code?.startsWith('SQLITE_CONSTRAINT')){
                const toThrow = new DatabaseConnectionError("ConstrainError", "No se puede eliminar: tiene datos asociados.", error)
                throw toThrow;
            }
        }
        return result
    }

    fetchGroupsForPhase(phaseId: number): Group[] {
        return this.database.prepare<[number], Group>('SELECT * FROM groups_table WHERE phaseId=? ORDER BY name').all(phaseId)
    }

    insertGroup(phaseId: number, name: string): Group | undefined {
        const result = this.database.prepare('INSERT INTO groups_table(phaseId,name) VALUES(?,?)').run(phaseId, name)
        return this.fetchOneElementFromTable<Group>('groups_table', result.lastInsertRowid)
    }

    updateGroup(id: number, name: string): Group | undefined {
        const result = this.database.prepare('UPDATE groups_table SET name=? WHERE id=?').run(name, id)
        return result.changes ? this.fetchOneElementFromTable<Group>('groups_table', id) : undefined
    }

    fetchAllPhasesForTournamentId(tournamentId: number): Phase[] {
        return this.database.prepare<[number], Phase>('SELECT * FROM phases WHERE tournamentId=? ORDER BY sortOrder,id').all(tournamentId)
    }

    insertPhase(phase: Omit<Phase, 'id'>): Phase | undefined {
        const result = this.database.prepare('INSERT INTO phases(tournamentId,name,type,tournamentType,sortOrder) VALUES(@tournamentId,@name,@type,@tournamentType,@sortOrder)').run(phase)
        return this.fetchOneElementFromTable<Phase>('phases', result.lastInsertRowid)
    }

    updatePhase(id: number, phase: Pick<Phase, 'name' | 'type' | 'tournamentType' | 'sortOrder'>): Phase | undefined {
        this.database.transaction(() => {
            this.database.prepare('UPDATE phases SET name=@name,type=@type,tournamentType=@tournamentType,sortOrder=@sortOrder WHERE id=@id').run({ id, ...phase })
            this.database.prepare('UPDATE matches SET tournamentType=? WHERE phaseId=?').run(phase.tournamentType, id)
        })()
        return this.fetchOneElementFromTable<Phase>('phases', id)
    }

    deletePhase(id: number): boolean {
        if (!this.fetchOneElementFromTable<Phase>('phases', id)) return false
        if (this.database.prepare('SELECT 1 FROM matches WHERE phaseId=?').get(id)) {
            throw new DatabaseConnectionError('ConstrainError', 'No se puede eliminar: la fase tiene partidos asociados.', undefined)
        }
        this.database.transaction(() => {
            this.database.prepare('UPDATE tournaments SET currentPhaseId=NULL WHERE currentPhaseId=?').run(id)
            this.database.prepare('DELETE FROM phase_memberships WHERE phaseId=?').run(id)
            this.database.prepare('DELETE FROM sanctions WHERE phaseId=?').run(id)
            this.database.prepare('DELETE FROM groups_table WHERE phaseId=?').run(id)
            this.database.prepare('DELETE FROM phases WHERE id=?').run(id)
        })()
        return true
    }

}

export default DBConnection
