export const meta = {
  name: 'split-god-file',
  description: 'Split tiny-world-builder.html (34.5k-line inline <script> + 4.6k CSS) into ~25-30 ordered classic-script modules on a branch, verified byte-equal + runtime-clean',
  whenToUse: 'Break the tinyworld god file into maintainable modules without changing behavior',
  phases: [
    { title: 'Analyze', detail: 'parallel readers map each section: purpose + top-level globals' },
    { title: 'Plan', detail: 'pick ~27 contiguous split points and module names' },
    { title: 'Extract', detail: 'deterministic sed slicing + HTML rewrite on a branch' },
    { title: 'Verify', detail: 'gate 1 byte-equivalence diff, gate 2 headless console-clean load' },
  ],
}

// ----------------------------------------------------------------------------
// Authoritative constants (verified from the live file before authoring)
// ----------------------------------------------------------------------------
const REPO = '/Users/jkneen/Documents/GitHub/tinyworld'
const SRC = 'tiny-world-builder.html'
const BRANCH = 'refactor/split-god-file'
const MOD_DIR = 'engine/world'
const CSS_FILE = 'styles/tiny-world.css'

const CONTENT_START = 5972          // first line of inline JS (leading /* */ banner)
const CONTENT_END = 40499           // last line of inline JS (initAuth();)
const CSS_START = 9, CSS_END = 4664 // between <style>(8) and </style>(4665)
const MIDDLE_START = 4666, MIDDLE_END = 5970 // </style>..(line before big <script>)
const TAIL_START = 40501            // </body></html>
const DEV_URL = 'http://localhost:3000/tiny-world-builder'

// 75 safe top-level cut points: [absoluteLine, sectionName]
// (2-space-indent, 8-dash banners only — guaranteed statement boundaries)
const SECTIONS = [
  [5976,'constants'],[6284,'scene renderer'],[6325,'landscape mesh mode state'],
  [6692,'repaint profiler'],[6800,'pixelation post-process'],[6981,'render culling'],
  [7296,'stats overlay'],[7377,'cameras'],[7523,'lighting'],[7652,'geometry helpers'],
  [7829,'materials'],[7966,'procedural pixel-art textures'],[9350,'tile factory'],
  [10489,'undo redo history'],[10811,'object factories'],[11311,'house primitives assembler'],
  [12847,'voxel stamp renderer'],[13252,'repo model stamp loader'],[16237,'world data'],
  [16345,'live index sets'],[17139,'seeded vehicle demo'],[17746,'crowd layer'],
  [18169,'selection select-tool'],[19039,'distant world dressing'],[19379,'home board border'],
  [19408,'ghost worlds'],[19419,'dormant cheap ghost instancing'],[19462,'editable duplicate islands'],
  [19897,'mooring cables'],[20416,'ghost world generator'],[20660,'fade material cache'],
  [20987,'cheap ghost instancing'],[21699,'drop-in animation system'],[21897,'adjacency helpers'],
  [22355,'weather tile effects'],[22409,'low-level renderers'],[23075,'initial scene'],
  [23209,'hover indicator'],[23218,'ghost placement preview'],[23367,'raycaster'],
  [23622,'webxr modes'],[23970,'tools'],[24046,'toolbar 3d thumbnails'],
  [25473,'click place erase'],[25830,'input orbit place touch'],[27529,'render settings'],
  [29459,'audio'],[29681,'positional audio'],[30068,'chimney smoke'],
  [30249,'squash dust fade'],[30391,'voxel clouds'],[31143,'crop duster'],
  [31229,'crop duster route state'],[31275,'banner streamer'],[31359,'bottom-left tips'],
  [31430,'dev save defaults'],[31508,'island front banner'],[32064,'animation loop'],
  [32214,'resize'],[32238,'world schema'],[32909,'ai generation'],
  [33707,'landscape engine integration'],[34940,'generate modal wiring'],[34941,'generate panel state'],
  [35707,'floating agent wiring'],[37453,'persistence'],[38072,'api webhooks sse bridge'],
  [38313,'welcome dialog'],[38368,'profile saves'],[38593,'auth'],[38893,'boot'],
  [38944,'minimap'],[39539,'view-modes time-weather dev popups'],[39950,'world-name popup menu'],
  [40201,'command palette'],
]
const BANNER_LINES = SECTIONS.map(s => s[0])

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'section'

// ----------------------------------------------------------------------------
// PHASE 1 — Analyze (parallel readers enrich sections for naming/grouping)
// ----------------------------------------------------------------------------
phase('Analyze')
const READER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          line: { type: 'number' },
          purpose: { type: 'string' },
          globals: { type: 'array', items: { type: 'string' } },
        },
        required: ['line', 'purpose', 'globals'],
      },
    },
  },
  required: ['sections'],
}

const NCHUNKS = 8
const chunks = []
const per = Math.ceil(SECTIONS.length / NCHUNKS)
for (let i = 0; i < SECTIONS.length; i += per) chunks.push(SECTIONS.slice(i, i + per))

const readerResults = await parallel(chunks.map((chunk, ci) => () => {
  const first = chunk[0][0]
  const nextIdx = BANNER_LINES.indexOf(chunk[chunk.length - 1][0]) + 1
  const spanEnd = nextIdx < BANNER_LINES.length ? BANNER_LINES[nextIdx] - 1 : CONTENT_END
  const list = chunk.map(([l, n]) => `  - line ${l}: ${n}`).join('\n')
  return agent(
    `You are mapping one span of a large single-file Three.js app at ${REPO}/${SRC}.\n` +
    `Your span is lines ${first}-${spanEnd}. It contains these top-level sections (banner line: name):\n${list}\n\n` +
    `Do NOT read the whole span line-by-line. Instead run, from ${REPO}:\n` +
    `  sed -n '${first},${spanEnd}p' ${SRC} | grep -nE '^  (function|const|let|var|class) [A-Za-z]'\n` +
    `to list the top-level identifiers, and read small excerpts only if a section's purpose is unclear.\n\n` +
    `For EACH section in your list, return: its banner line, a one-line purpose, and up to 8 of the most ` +
    `important top-level global identifiers it defines (function/const/let/class names). ` +
    `These feed a grouping step, so be concise and accurate. Return only the listed sections.`,
    { label: `analyze:${first}-${spanEnd}`, phase: 'Analyze', schema: READER_SCHEMA },
  )
}))

const enrich = {}
for (const r of readerResults.filter(Boolean)) for (const s of (r.sections || [])) enrich[s.line] = s
log(`Analyzed ${Object.keys(enrich).length}/${SECTIONS.length} sections`)

// ----------------------------------------------------------------------------
// PHASE 2 — Plan: LLM picks contiguous split points; JS computes byte ranges
// ----------------------------------------------------------------------------
phase('Plan')
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    modules: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          startBannerLine: { type: 'number' },
          fileBaseName: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['startBannerLine', 'fileBaseName', 'description'],
      },
    },
  },
  required: ['modules'],
}

const sectionTable = SECTIONS.map(([l, n]) => {
  const e = enrich[l]
  const g = e && e.globals && e.globals.length ? ` | globals: ${e.globals.slice(0, 8).join(', ')}` : ''
  const p = e && e.purpose ? ` — ${e.purpose}` : ''
  return `  ${l}: ${n}${p}${g}`
}).join('\n')

const plan = await agent(
  `You are grouping the top-level sections of ${SRC} into modules for extraction into separate ` +
  `ordered classic <script src> files. The sections (banner line: name — purpose | globals):\n\n${sectionTable}\n\n` +
  `RULES (critical):\n` +
  `1. Modules MUST be CONTIGUOUS spans in the order shown. Load order = source order, so you may ONLY ` +
  `group ADJACENT sections. Never reorder or group non-adjacent sections.\n` +
  `2. Produce 25-30 modules. Each module = one or more adjacent sections grouped by theme ` +
  `(e.g. constants+scene+cameras+lighting; materials+textures; tiles+objects+houses; models; ` +
  `world+ghosts+islands; weather+particles; input+tools; audio; ai-generation; landscape; ui-wiring; persistence+boot).\n` +
  `3. Keep the largest sections (materials/textures ~7966, houses ~11311, models ~13252, render-settings ~27529, ` +
  `ai-generation ~32909, landscape-integration ~33707) as their OWN module where reasonable.\n` +
  `4. Each module: startBannerLine = the banner line where it BEGINS (must be one of the listed lines). ` +
  `The FIRST module MUST start at line 5976. List modules in increasing startBannerLine order.\n` +
  `5. fileBaseName = short kebab-case, no extension, no number prefix (e.g. "materials-textures").\n` +
  `Return only the modules array.`,
  { label: 'plan-modules', phase: 'Plan', schema: PLAN_SCHEMA },
)

// --- validate + compute ranges deterministically (LLM picks where, JS computes bytes) ---
let splits = (plan && plan.modules ? plan.modules : [])
  .filter(m => BANNER_LINES.includes(m.startBannerLine))
  .sort((a, b) => a.startBannerLine - b.startBannerLine)
// de-dup startBannerLine
splits = splits.filter((m, i) => i === 0 || m.startBannerLine !== splits[i - 1].startBannerLine)

const valid = splits.length >= 18 && splits.length <= 40 && splits[0].startBannerLine === 5976
if (!valid) {
  log(`Planner output invalid (${splits.length} modules); using deterministic fallback grouping (~25)`)
  splits = []
  const step = 3
  for (let i = 0; i < SECTIONS.length; i += step) {
    const [l, n] = SECTIONS[i]
    splits.push({ startBannerLine: l, fileBaseName: slug(n), description: n })
  }
  splits[0].startBannerLine = 5976
}

const modules = splits.map((m, k) => {
  const start = k === 0 ? CONTENT_START : m.startBannerLine
  const end = k === splits.length - 1 ? CONTENT_END : splits[k + 1].startBannerLine - 1
  const file = `${MOD_DIR}/${String(k + 1).padStart(2, '0')}-${slug(m.fileBaseName)}.js`
  return { file, start, end, description: m.description || '' }
})
log(`Plan: ${modules.length} modules covering lines ${CONTENT_START}-${CONTENT_END}`)

// ----------------------------------------------------------------------------
// PHASE 3 — Extract (deterministic; the bash below is authored here, not by the agent)
// ----------------------------------------------------------------------------
phase('Extract')

const sliceLines = modules.map(m => `sed -n '${m.start},${m.end}p' "$SRC" > "${m.file}"`).join('\n')
const tagLines = modules.map(m => `  <script src="${m.file}"></script>`).join('\n')

const extractSh = [
  `#!/usr/bin/env bash`,
  `set -euo pipefail`,
  `cd ${REPO}`,
  `SRC=${SRC}`,
  `# fresh branch from current HEAD (clean main = the revert point)`,
  `git rev-parse --verify ${BRANCH} >/dev/null 2>&1 && git branch -D ${BRANCH} || true`,
  `git checkout -b ${BRANCH}`,
  `mkdir -p ${MOD_DIR} styles`,
  ``,
  `# 1) save originals for byte-equivalence gate`,
  `sed -n '${CONTENT_START},${CONTENT_END}p' "$SRC" > /tmp/twb_orig_js.txt`,
  `sed -n '${CSS_START},${CSS_END}p' "$SRC" > /tmp/twb_orig_css.txt`,
  ``,
  `# 2) extract CSS (whole-block move)`,
  `sed -n '${CSS_START},${CSS_END}p' "$SRC" > ${CSS_FILE}`,
  ``,
  `# 3) extract JS modules (verbatim contiguous slices)`,
  sliceLines,
  ``,
  `# 4) build the ordered <script src> tag block`,
  `cat > /tmp/twb_tags.txt <<'TAGS'`,
  tagLines,
  `TAGS`,
  ``,
  `# 5) rebuild the HTML (reads original $SRC, writes /tmp, then moves) — MUST be last read of $SRC`,
  `{`,
  `  sed -n '1,7p' "$SRC"`,
  `  echo '  <link rel="stylesheet" href="${CSS_FILE}">'`,
  `  sed -n '${MIDDLE_START},${MIDDLE_END}p' "$SRC"`,
  `  cat /tmp/twb_tags.txt`,
  `  sed -n '${TAIL_START},$p' "$SRC"`,
  `} > /tmp/twb_new.html`,
  `mv /tmp/twb_new.html "$SRC"`,
  ``,
  `git add -A`,
  `git commit -q -m "Refactor: split tiny-world-builder.html into ${modules.length} JS modules + external CSS" `,
  `echo "COMMIT $(git rev-parse --short HEAD)"`,
  `echo "DONE ${modules.length} modules"`,
].join('\n')

const EXECUTE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    commit: { type: 'string' },
    output: { type: 'string' },
  },
  required: ['success', 'output'],
}

const exec = await agent(
  `Perform a deterministic file-extraction. Two steps, no improvisation:\n\n` +
  `STEP 1: Use the Write tool to create the file /tmp/twb_extract.sh with EXACTLY the content below — ` +
  `verbatim, byte-for-byte, do not add, remove, reformat, or "fix" a single character:\n\n` +
  `=====BEGIN /tmp/twb_extract.sh=====\n${extractSh}\n=====END /tmp/twb_extract.sh=====\n\n` +
  `STEP 2: Run \`bash /tmp/twb_extract.sh\` and capture all stdout+stderr.\n\n` +
  `Return success=true only if the script exits 0 and prints a DONE line. Put the captured output ` +
  `(and the COMMIT short sha) in the fields. If it fails, success=false and include the full error output.`,
  { label: 'extract', phase: 'Extract', schema: EXECUTE_SCHEMA },
)

if (!exec || !exec.success) {
  log('Extraction failed — aborting before verification')
  return { ok: false, stage: 'extract', modules: modules.length, detail: exec ? exec.output : 'no result' }
}

// ----------------------------------------------------------------------------
// PHASE 4 — Verify (two hard gates)
// ----------------------------------------------------------------------------
phase('Verify')
const concatCmd =
  `cat ${modules.map(m => `"${m.file}"`).join(' ')} > /tmp/twb_concat.js && ` +
  `diff /tmp/twb_concat.js /tmp/twb_orig_js.txt`

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    byteMatchJs: { type: 'boolean' },
    byteMatchCss: { type: 'boolean' },
    runtimeClean: { type: 'boolean' },
    blockingErrors: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['byteMatchJs', 'byteMatchCss', 'runtimeClean', 'blockingErrors', 'notes'],
}

const verify = await agent(
  `Verify the extraction on branch ${BRANCH} in ${REPO}. TWO gates, both required.\n\n` +
  `GATE 1 — byte-equivalence (proves nothing was lost/reordered). Run from ${REPO}:\n` +
  `  (a) ${concatCmd}\n` +
  `      -> empty diff = byteMatchJs:true. Any output = false (paste it into notes).\n` +
  `  (b) diff ${CSS_FILE} /tmp/twb_orig_css.txt\n` +
  `      -> empty diff = byteMatchCss:true.\n\n` +
  `GATE 2 — runtime console-clean load (proves no cross-file forward-reference / TDZ / split-function breakage, ` +
  `which byte-equality CANNOT catch). Steps:\n` +
  `  1. Start the dev server in the background: \`cd ${REPO} && node tools/dev-server.js >/tmp/twb_server.log 2>&1 &\` then wait ~2s.\n` +
  `  2. Use the playwright MCP browser tools (find them via ToolSearch query "select:mcp__plugin_playwright_playwright__browser_navigate,mcp__plugin_playwright_playwright__browser_console_messages,mcp__plugin_playwright_playwright__browser_close"). ` +
  `Navigate to ${DEV_URL}, wait ~3s for scripts to run, then read console messages.\n` +
  `  3. Kill the server (\`pkill -f tools/dev-server.js\` or kill the bg job).\n\n` +
  `CLASSIFY console output. BLOCKING (runtimeClean:false) = any of: "is not defined", ` +
  `"Cannot access ... before initialization", "ReferenceError", "SyntaxError", "Unexpected end of input", ` +
  `"is not a function" originating from one of the engine/world/*.js module files. ` +
  `IGNORE (not blocking): WebGL / WebGL2 context warnings, AudioContext autoplay/gesture warnings, ` +
  `404s for optional assets, favicon, and any pre-existing warnings unrelated to the split. ` +
  `List every blocking error in blockingErrors. Set runtimeClean=true only if there are none.`,
  { label: 'verify', phase: 'Verify', schema: VERIFY_SCHEMA },
)

const pass = verify && verify.byteMatchJs && verify.byteMatchCss && verify.runtimeClean
log(pass ? 'VERIFIED: byte-equal + runtime-clean' : 'VERIFICATION FAILED — see report')

return {
  ok: !!pass,
  branch: BRANCH,
  modules: modules.length,
  commit: exec.commit || '',
  moduleFiles: modules.map(m => ({ file: m.file, lines: m.end - m.start + 1, desc: m.description })),
  cssFile: CSS_FILE,
  gates: {
    byteEqualJs: !!(verify && verify.byteMatchJs),
    byteEqualCss: !!(verify && verify.byteMatchCss),
    runtimeClean: !!(verify && verify.runtimeClean),
  },
  blockingErrors: (verify && verify.blockingErrors) || [],
  notes: (verify && verify.notes) || '',
}
