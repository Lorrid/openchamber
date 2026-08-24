import fs from 'fs';
import path from 'path';
import { getLinearAuthFilePath } from './auth.js';
import { isPlainObject, readTrimmedString } from './parse.js';

export class LinearMappingError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LinearMappingError';
    this.code = code;
  }
}

function mappingFile() {
  return path.join(path.dirname(getLinearAuthFilePath()), 'linear-mapping.json');
}

function emptyMapping() {
  return {
    defaultProjectPath: null,
    teamProjectPaths: {},
  };
}

function readTeamProjectPaths(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  const next = {};
  for (const key of Object.keys(value)) {
    const teamId = readTrimmedString(key);
    const projectPath = readTrimmedString(value[key]);
    if (teamId && projectPath) {
      next[teamId] = projectPath;
    }
  }
  return next;
}

function normalizeStoredMapping(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  return {
    defaultProjectPath: readTrimmedString(raw.defaultProjectPath) || null,
    teamProjectPaths: readTeamProjectPaths(raw.teamProjectPaths),
  };
}

function writeJsonFile(filePath, payload) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
  try {
    fs.chmodSync(tmpFile, 0o600);
  } catch {
    // best-effort
  }
  fs.renameSync(tmpFile, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

export function getLinearMappingFilePath() {
  return mappingFile();
}

export function readStoredLinearMapping() {
  const filePath = mappingFile();
  if (!fs.existsSync(filePath)) {
    return emptyMapping();
  }
  let parsed;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) {
      return emptyMapping();
    }
    parsed = JSON.parse(trimmed);
  } catch {
    throw new LinearMappingError('Linear mapping file is malformed', 'MALFORMED');
  }
  const normalized = normalizeStoredMapping(parsed);
  if (!normalized) {
    throw new LinearMappingError('Linear mapping file is malformed', 'MALFORMED');
  }
  return normalized;
}

export function setStoredLinearMapping(input) {
  if (!isPlainObject(input)) {
    throw new LinearMappingError('Mapping body must be an object', 'INVALID');
  }
  const next = {
    defaultProjectPath: readTrimmedString(input.defaultProjectPath) || null,
    teamProjectPaths: readTeamProjectPaths(input.teamProjectPaths),
  };
  writeJsonFile(mappingFile(), next);
  return next;
}

export function mergeLinearMappingView(stored, teams) {
  const mapping = stored || emptyMapping();
  const nodes = Array.isArray(teams) ? teams : [];
  return {
    defaultProjectPath: mapping.defaultProjectPath,
    teams: nodes.map((team) => ({
      id: team.id,
      key: team.key,
      name: team.name,
      projectPath: mapping.teamProjectPaths[team.id] || null,
    })),
  };
}

export function resolveMappedProjectPath(view, team) {
  const teams = Array.isArray(view?.teams) ? view.teams : [];
  const teamId = team ? readTrimmedString(team.id) : '';
  if (teamId) {
    const row = teams.find((entry) => entry.id === teamId);
    if (row?.projectPath) {
      return row.projectPath;
    }
  }
  const teamKey = team ? readTrimmedString(team.key) : '';
  if (teamKey) {
    const row = teams.find((entry) => entry.key === teamKey);
    if (row?.projectPath) {
      return row.projectPath;
    }
  }
  return view?.defaultProjectPath || null;
}
