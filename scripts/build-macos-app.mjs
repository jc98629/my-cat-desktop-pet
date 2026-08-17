import { execFileSync } from 'node:child_process';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const packageMetadata = JSON.parse(
  await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
);

const productName = packageMetadata.productName ?? 'QiuQiu';
const bundleIdentifier = 'com.jc98629.qiuqiu';
const bundledIconName = 'QiuQiu.icns';
const sourceApp = path.join(
  projectRoot,
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
);
const releaseDirectory = path.join(projectRoot, 'release');
const targetApp = path.join(releaseDirectory, `${productName}.app`);
const targetContents = path.join(targetApp, 'Contents');
const targetResources = path.join(targetContents, 'Resources');
const targetApplication = path.join(targetResources, 'app');
const targetExecutable = path.join(targetContents, 'MacOS', productName);
const iconPng = path.join(projectRoot, 'assets', 'icon', 'app-icon.png');
const iconIcns = path.join(projectRoot, 'assets', 'icon', 'app-icon.icns');

const iconRepresentations = [
  { type: 'icp4', size: 16 },
  { type: 'icp5', size: 32 },
  { type: 'icp6', size: 64 },
  { type: 'ic07', size: 128 },
  { type: 'ic08', size: 256 },
  { type: 'ic09', size: 512 },
  { type: 'ic10', size: 1024 },
];

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

async function buildIcns() {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'my-cat-desktop-pet-icon-'),
  );

  try {
    const chunks = [];

    for (const representation of iconRepresentations) {
      const resizedPng = path.join(
        temporaryDirectory,
        `icon-${representation.size}.png`,
      );
      run('/usr/bin/sips', [
        '-z',
        String(representation.size),
        String(representation.size),
        iconPng,
        '--out',
        resizedPng,
      ]);

      const pngData = await readFile(resizedPng);
      const chunkHeader = Buffer.alloc(8);
      chunkHeader.write(representation.type, 0, 4, 'ascii');
      chunkHeader.writeUInt32BE(pngData.length + chunkHeader.length, 4);
      chunks.push(chunkHeader, pngData);
    }

    const payloadLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const fileHeader = Buffer.alloc(8);
    fileHeader.write('icns', 0, 4, 'ascii');
    fileHeader.writeUInt32BE(payloadLength + fileHeader.length, 4);
    await writeFile(iconIcns, Buffer.concat([fileHeader, ...chunks]));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function updatePlist(plistPath, key, value) {
  run('/usr/libexec/PlistBuddy', [
    '-c',
    `Set :${key} ${value}`,
    plistPath,
  ]);
}

await buildIcns();
await mkdir(releaseDirectory, { recursive: true });
await rm(targetApp, { recursive: true, force: true });
await cp(sourceApp, targetApp, {
  recursive: true,
  force: true,
  dereference: false,
  verbatimSymlinks: true,
});

const originalExecutable = path.join(targetContents, 'MacOS', 'Electron');
await rename(originalExecutable, targetExecutable);
await chmod(targetExecutable, 0o755);

await rm(targetApplication, { recursive: true, force: true });
await mkdir(targetApplication, { recursive: true });

for (const projectItem of ['package.json', 'dist', 'dist-electron']) {
  await cp(
    path.join(projectRoot, projectItem),
    path.join(targetApplication, projectItem),
    { recursive: true, force: true },
  );
}

await mkdir(path.join(targetApplication, 'assets'), { recursive: true });
await cp(
  path.join(projectRoot, 'assets', 'tray'),
  path.join(targetApplication, 'assets', 'tray'),
  { recursive: true, force: true },
);
await cp(iconIcns, path.join(targetResources, bundledIconName), { force: true });

const infoPlist = path.join(targetContents, 'Info.plist');
updatePlist(infoPlist, 'CFBundleDisplayName', productName);
updatePlist(infoPlist, 'CFBundleExecutable', productName);
updatePlist(infoPlist, 'CFBundleIconFile', bundledIconName);
updatePlist(infoPlist, 'CFBundleIdentifier', bundleIdentifier);
updatePlist(infoPlist, 'CFBundleName', productName);
updatePlist(infoPlist, 'CFBundleShortVersionString', packageMetadata.version);
updatePlist(infoPlist, 'CFBundleVersion', packageMetadata.version);
updatePlist(
  infoPlist,
  'LSApplicationCategoryType',
  'public.app-category.entertainment',
);

run('/usr/bin/codesign', [
  '--force',
  '--deep',
  '--sign',
  '-',
  '--timestamp=none',
  targetApp,
]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', targetApp]);

console.log(`\nCreated ${targetApp}`);
