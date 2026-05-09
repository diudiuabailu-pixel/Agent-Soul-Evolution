import fs from 'fs-extra';
import path from 'node:path';
import { skillCatalog } from '../skills/catalog.js';
import type { SkillManifest } from '../types.js';
import { runtimeRoot } from './paths.js';

function externalSkillsRoot(): string {
  return path.join(runtimeRoot(), 'skills', 'packages');
}

export async function ensureExternalSkillsRoot(): Promise<void> {
  await fs.ensureDir(externalSkillsRoot());
}

export async function loadExternalSkillManifests(): Promise<SkillManifest[]> {
  await ensureExternalSkillsRoot();
  const root = externalSkillsRoot();
  const entries = await fs.readdir(root);
  const manifests: SkillManifest[] = [];

  for (const entry of entries) {
    const manifestPath = path.join(root, entry, 'skill.json');
    if (await fs.pathExists(manifestPath)) {
      const manifest = await fs.readJson(manifestPath) as SkillManifest;
      manifests.push(manifest);
    }
  }

  return manifests;
}

export async function loadAllSkillManifests(): Promise<SkillManifest[]> {
  const external = await loadExternalSkillManifests();
  return [...skillCatalog, ...external];
}

export async function installSkillPackage(sourceDir: string): Promise<SkillManifest> {
  await ensureExternalSkillsRoot();
  const manifestPath = path.join(sourceDir, 'skill.json');
  if (!(await fs.pathExists(manifestPath))) {
    throw new Error('skill.json not found in provided directory');
  }

  const manifest = await fs.readJson(manifestPath) as SkillManifest;
  const targetDir = path.join(externalSkillsRoot(), manifest.id);
  await fs.remove(targetDir);
  await fs.copy(sourceDir, targetDir);
  return manifest;
}
