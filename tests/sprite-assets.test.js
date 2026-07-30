const fs = require('fs');
const path = require('path');

const SPRITE_ROOT = path.join(__dirname, '..', 'client', 'assets', 'sprites');
const EXPECTED_MANIFESTS = 657;

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function readPngDimensions(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (header.length < 24 || !header.subarray(0, 8).equals(signature)) {
    throw new Error('not a PNG');
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function validateManifest(manifestPath, manifest, requireSheets) {
  const errors = [];
  const relative = path.relative(SPRITE_ROOT, manifestPath);
  const sheets = Array.isArray(manifest.sheets) ? manifest.sheets : [];
  const frames = manifest.frames && typeof manifest.frames === 'object' ? manifest.frames : {};

  if (sheets.length === 0) errors.push(`${relative}: no sheets`);
  if (!manifest.frames || typeof manifest.frames !== 'object') errors.push(`${relative}: frames is not an object`);

  const dimensions = new Map();
  sheets.forEach((sheet, index) => {
    if (typeof sheet !== 'string' || path.basename(sheet) !== sheet) {
      errors.push(`${relative}: sheet ${index} is not a safe relative filename`);
      return;
    }
    const sheetPath = path.join(path.dirname(manifestPath), sheet);
    if (!fs.existsSync(sheetPath)) {
      if (requireSheets) errors.push(`${relative}: missing local sheet ${sheet}`);
      return;
    }
    try {
      dimensions.set(index, readPngDimensions(sheetPath));
    } catch (error) {
      errors.push(`${relative}: ${sheet}: ${error.message}`);
    }
  });

  for (const [frameName, frameData] of Object.entries(frames)) {
    const sheetIndex = frameData && frameData.sheet;
    const rect = frameData && frameData.frame;
    if (!Number.isInteger(sheetIndex) || sheetIndex < 0 || sheetIndex >= sheets.length) {
      errors.push(`${relative}: frame ${frameName} has invalid sheet index`);
      continue;
    }
    if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)
        || rect.x < 0 || rect.y < 0 || rect.w <= 0 || rect.h <= 0) {
      errors.push(`${relative}: frame ${frameName} has an invalid rectangle`);
      continue;
    }
    const size = dimensions.get(sheetIndex);
    if (size && (rect.x + rect.w > size.width || rect.y + rect.h > size.height)) {
      errors.push(`${relative}: frame ${frameName} exceeds ${sheets[sheetIndex]}`);
    }
  }

  for (const [animationName, frameNames] of Object.entries(manifest.animations || {})) {
    if (!Array.isArray(frameNames)) {
      errors.push(`${relative}: animation ${animationName} is not an array`);
      continue;
    }
    for (const frameName of frameNames) {
      if (!Object.prototype.hasOwnProperty.call(frames, frameName)) {
        errors.push(`${relative}: animation ${animationName} references missing frame ${frameName}`);
      }
    }
  }

  return errors;
}

function loadManifests() {
  return walk(SPRITE_ROOT)
    .filter(filePath => path.extname(filePath) === '.json')
    .filter(filePath => path.basename(filePath, '.json') === path.basename(path.dirname(filePath)))
    .map(filePath => ({ filePath, manifest: JSON.parse(fs.readFileSync(filePath, 'utf8')) }));
}

test('all generated sprite manifests are valid and indexed', () => {
  const manifests = loadManifests();
  const requireSheets = process.env.MMOLITE_REQUIRE_LOCAL_ASSETS === '1';
  const errors = manifests.flatMap(({ filePath, manifest }) =>
    validateManifest(filePath, manifest, requireSheets));

  const indexPath = path.join(SPRITE_ROOT, 'sprite_index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const byName = new Map(manifests.map(entry =>
    [path.basename(entry.filePath, '.json'), entry.manifest]));

  expect(manifests).toHaveLength(EXPECTED_MANIFESTS);
  expect(Object.keys(index).sort()).toEqual([...byName.keys()].sort());
  for (const [name, entry] of Object.entries(index)) {
    expect(entry.sheets).toEqual(byName.get(name).sheets);
    expect(entry.frames.slice().sort()).toEqual(Object.keys(byName.get(name).frames).sort());
    expect(entry.animations.slice().sort()).toEqual(Object.keys(byName.get(name).animations || {}).sort());
  }
  expect(errors).toEqual([]);
});

test('manifest validation rejects a dangling animation reference', () => {
  const [{ filePath, manifest }] = loadManifests();
  const broken = JSON.parse(JSON.stringify(manifest));
  broken.animations = { regression_probe: ['missing_frame_for_regression_probe'] };

  expect(validateManifest(filePath, broken, false)).toEqual(
    expect.arrayContaining([expect.stringContaining('references missing frame')]));
});
