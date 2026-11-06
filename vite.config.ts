import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const LICENSE_FILE = 'third-party-licenses.txt';

/**
 * 同梱しているライブラリのライセンス文を一覧にする。
 * MIT / ISC ライセンスは配布物に著作権表示とライセンス文を含めることを求めている。
 *
 * Vite 標準の build.license は Web Worker 側に入るライブラリ（d3-contour など）を拾わないため、
 * package.json の dependencies を再帰的にたどって作る。画面右下の「ライセンス」からリンクしている。
 */
function buildLicenseText(root: string): string {
  const seen = new Map<string, { version: string; license: string; text: string }>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    const dir = join(root, 'node_modules', name);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const file = readdirSync(dir).find((f) => /^(license|licence)(\.|$)/i.test(f));
    if (!file) throw new Error(`${name} のライセンスファイルが見つかりません`);
    seen.set(name, { version: pkg.version, license: pkg.license, text: readFileSync(join(dir, file), 'utf8').trim() });
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep);
  };
  const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const dep of Object.keys(rootPkg.dependencies ?? {})) visit(dep);

  const sections = [...seen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, p]) => `## ${name} ${p.version} (${p.license})\n\n${p.text}`);
  return [
    '# Third-party licenses',
    '',
    'This game bundles the following open-source libraries.',
    '',
    'Elevation data: 国土地理院 地理院タイル（標高タイル）を加工して作成',
    'https://maps.gsi.go.jp/development/ichiran.html',
    '',
    ...sections.flatMap((s) => [s, '']),
  ].join('\n');
}

function thirdPartyLicenses(): Plugin {
  let root = process.cwd();
  return {
    name: 'third-party-licenses',
    configResolved(config) {
      root = config.root;
      if (!existsSync(join(root, 'node_modules'))) throw new Error('node_modules がありません');
    },
    // 開発サーバーでも同じ URL で見られるようにする
    configureServer(server) {
      server.middlewares.use(`/${LICENSE_FILE}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(buildLicenseText(root));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: LICENSE_FILE, source: buildLicenseText(root) });
    },
  };
}

export default defineConfig({
  plugins: [thirdPartyLicenses()],
});
