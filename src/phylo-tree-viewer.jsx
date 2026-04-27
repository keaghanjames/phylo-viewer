import { useState, useEffect, useRef } from "react";
import * as d3 from "d3";

function parseAnnotationContent(str) {
  const result = {};
  let j = 0;
  while (j < str.length) {
    let key = "";
    while (j < str.length && str[j] !== "=") key += str[j++];
    if (j >= str.length || !key.trim()) break;
    j++;
    let val = "";
    if (j < str.length && str[j] === "{") {
      while (j < str.length && str[j] !== "}") val += str[j++];
      val += "}"; if (j < str.length) j++;
    } else if (j < str.length && str[j] === '"') {
      j++;
      while (j < str.length && str[j] !== '"') val += str[j++];
      if (j < str.length) j++;
    } else {
      while (j < str.length && str[j] !== ",") val += str[j++];
    }
    if (key.trim()) result[key.trim()] = val.trim();
    if (j < str.length && str[j] === ",") j++;
  }
  return result;
}

function parseNewick(s) {
  s = s.trim().replace(/;$/, "");
  let i = 0;
  function parseAnnotation() {
    if (s[i] !== "[") return null;
    i++;
    let content = "";
    while (i < s.length && s[i] !== "]") content += s[i++];
    if (i < s.length) i++;
    if (!content.startsWith("&")) return null;
    return parseAnnotationContent(content.slice(1));
  }
  function parseNode() {
    let node = { name: "", length: null, children: [], annotations: null };
    if (s[i] === "(") {
      i++; node.children.push(parseNode());
      while (s[i] === ",") { i++; node.children.push(parseNode()); }
      i++;
    }
    let label = "";
    while (i < s.length && !":,()[".includes(s[i])) label += s[i++];
    node.name = label.trim();
    if (s[i] === "[") { const ann = parseAnnotation(); if (ann) node.annotations = ann; }
    if (s[i] === ":") {
      i++; let len = "";
      while (i < s.length && !",()[".includes(s[i])) len += s[i++];
      node.length = parseFloat(len);
    }
    if (s[i] === "[") { const ann = parseAnnotation(); if (ann) node.annotations = Object.assign(node.annotations || {}, ann); }
    return node;
  }
  try { return parseNode(); } catch(e) { return null; }
}

function toNewick(n) {
  const ann = n.annotations && Object.keys(n.annotations).length > 0
    ? "[&" + Object.entries(n.annotations).map(function(e) { return e[0] + "=" + e[1]; }).join(",") + "]"
    : "";
  if (!n.children || !n.children.length) return n.name + ann + (n.length != null ? ":" + n.length : "");
  return "(" + n.children.map(toNewick).join(",") + ")" + (n.name || "") + ann + (n.length != null ? ":" + n.length : "");
}

function cloneTree(n) { return JSON.parse(JSON.stringify(n)); }

function countLeaves(n) {
  if (!n.children || !n.children.length) return 1;
  return n.children.reduce(function(s, c) { return s + countLeaves(c); }, 0);
}

function getLeafNames(n) {
  if (!n.children || !n.children.length) return n.name ? [n.name] : [];
  return n.children.flatMap(getLeafNames);
}

function getLeafIds(n) {
  if (!n.children || !n.children.length) return n._id != null ? [n._id] : [];
  return n.children.flatMap(getLeafIds);
}

function sumBranchLengths(n) {
  const own = n.length || 0;
  if (!n.children || !n.children.length) return own;
  return own + n.children.reduce(function(s, c) { return s + sumBranchLengths(c); }, 0);
}

function nodeHeight(n) {
  if (!n.children || !n.children.length) return n.length || 0;
  return (n.length || 0) + Math.max.apply(null, n.children.map(nodeHeight));
}

function assignIds(n, ctr) {
  if (!ctr) ctr = { v: 0 };
  n._id = ctr.v++;
  n._collapsed = n._collapsed || false;
  if (n.children) n.children.forEach(function(c) { assignIds(c, ctr); });
  return n;
}

function ladderize(n, asc) {
  if (asc === undefined) asc = true;
  if (!n.children || !n.children.length) return n;
  n.children = n.children.map(function(c) { return ladderize(c, asc); });
  n.children.sort(function(a, b) { return asc ? countLeaves(a) - countLeaves(b) : countLeaves(b) - countLeaves(a); });
  return n;
}

function rerootTree(root, targetId) {
  const cloned = cloneTree(root);
  function rerootAt(node, tid) {
    const path = [];
    function findP(n, tid, p) {
      if (n._id === tid) { path.push.apply(path, p); path.push(n); return true; }
      if (!n.children) return false;
      for (let ci = 0; ci < n.children.length; ci++) {
        const np = p.slice(); np.push(n);
        if (findP(n.children[ci], tid, np)) return true;
      }
      return false;
    }
    findP(node, tid, []);
    if (path.length < 2) return node;
    for (let i = path.length - 1; i > 0; i--) {
      const child = path[i], parent = path[i - 1];
      parent.children = parent.children.filter(function(c) { return c._id !== child._id; });
      const oldLen = child.length; child.length = parent.length; parent.length = oldLen;
      if (!child.children) child.children = [];
      child.children.push(parent);
    }
    return path[path.length - 1];
  }
  return rerootAt(cloned, targetId);
}

function getDescendantIds(n) {
  const ids = new Set([n._id]);
  function walk(n) {
    if (!n.children) return;
    for (let i = 0; i < n.children.length; i++) { ids.add(n.children[i]._id); walk(n.children[i]); }
  }
  walk(n); return ids;
}

function findNode(n, id) {
  if (n._id === id) return n;
  if (!n.children) return null;
  for (let i = 0; i < n.children.length; i++) {
    const f = findNode(n.children[i], id);
    if (f) return f;
  }
  return null;
}

function computeMaxDepth(n, acc) {
  if (!acc) acc = 0;
  const d = acc + (n.length || 0);
  if (!n.children || !n.children.length) return d;
  return Math.max.apply(null, n.children.map(function(c) { return computeMaxDepth(c, d); }));
}

function hasBranchLengths(n) {
  if (n.length != null && !isNaN(n.length)) return true;
  if (!n.children) return false;
  return n.children.some(hasBranchLengths);
}

function stemLengthToNode(root, targetId) {
  function find(n, acc) {
    const d = acc + (n.length || 0);
    if (n._id === targetId) return d;
    if (!n.children) return null;
    for (let i = 0; i < n.children.length; i++) {
      const r = find(n.children[i], d);
      if (r !== null) return r;
    }
    return null;
  }
  const result = find(root, 0);
  return result !== null ? result : 0;
}

function pathToRoot(root, targetId) {
  function find(n, path) {
    const p = path.concat([n._id]);
    if (n._id === targetId) return p;
    if (!n.children) return null;
    for (let i = 0; i < n.children.length; i++) {
      const r = find(n.children[i], p);
      if (r) return r;
    }
    return null;
  }
  return find(root, []) || [];
}

function findMRCA(root, selectedIds) {
  if (selectedIds.size === 0) return null;
  const paths = Array.from(selectedIds).map(function(id) { return pathToRoot(root, id); });
  if (paths.some(function(p) { return p.length === 0; })) return null;
  let mrca = null;
  const minLen = Math.min.apply(null, paths.map(function(p) { return p.length; }));
  for (let i = 0; i < minLen; i++) {
    const id = paths[0][i];
    if (paths.every(function(p) { return p[i] === id; })) mrca = id;
    else break;
  }
  return mrca;
}

function computeConnectingBranches(root, selectedIds) {
  if (selectedIds.size < 2) return new Set();
  const mrcaId = findMRCA(root, selectedIds);
  if (mrcaId == null) return new Set();
  const parentMap = new Map();
  function buildParent(n, par) {
    if (par !== null) parentMap.set(n._id, par._id);
    if (!n.children) return;
    for (let i = 0; i < n.children.length; i++) buildParent(n.children[i], n);
  }
  buildParent(root, null);
  const edgeSet = new Set();
  selectedIds.forEach(function(id) {
    let cur = id;
    while (cur !== mrcaId && parentMap.has(cur)) {
      edgeSet.add(cur);
      cur = parentMap.get(cur);
    }
  });
  return edgeSet;
}

function sumEdgeLengths(root, edgeIds) {
  let total = 0;
  function walk(n) {
    if (edgeIds.has(n._id)) total += n.length || 0;
    if (n.children) n.children.forEach(walk);
  }
  walk(root);
  return total;
}

function parseNexusToNewick(text) {
  if (!/^#NEXUS/i.test(text.trim())) return null;

  // Find the TREES block
  const treesMatch = text.match(/BEGIN\s+TREES\s*;([\s\S]*?)END\s*;/i);
  if (!treesMatch) return null;
  const treesBlock = treesMatch[1];

  // Parse TRANSLATE table (maps short keys → full taxon names)
  const translateMap = {};
  const transMatch = treesBlock.match(/TRANSLATE\s+([\s\S]*?)\s*;/i);
  if (transMatch) {
    transMatch[1].split(',').forEach(function(entry) {
      const m = entry.trim().match(/^(\S+)\s+([\s\S]+)$/);
      if (m) translateMap[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
    });
  }

  // Find first TREE statement: TREE [*] name = [comment] newick;
  // Use [^\s=]+ for the tree name to avoid greedy \S+ consuming content when taxon names have no spaces
  const treeMatch = treesBlock.match(/TREE\s+(?:\*\s*)?[^\s=]+\s*=\s*([\s\S]+?)\s*;/i);
  if (!treeMatch) return null;

  // Strip plain [comments] but preserve BEAST [&annotations]
  // Handle both [comment] and [\[&...\]] (escaped-bracket BEAST annotations wrapped in NEXUS comments)
  let newick = treeMatch[1].replace(/\[(?!&)((?:[^\]\\]|\\[\s\S])*)\]/g, '').trim();

  // Apply translate by walking the parsed tree and substituting node names
  if (Object.keys(translateMap).length > 0) {
    const tree = parseNewick(newick);
    if (!tree) return null;
    function applyTrans(n) {
      if (n.name && translateMap[n.name] !== undefined) n.name = translateMap[n.name];
      if (n.children) n.children.forEach(applyTrans);
    }
    applyTrans(tree);
    return toNewick(tree) + ";";
  }

  return newick.endsWith(';') ? newick : newick + ';';
}

function computeLTT(root) {
  var events = [];
  function walk(n, d) {
    var depth = d + (n.length || 0);
    if (n.children && n.children.length) {
      events.push({ time: depth, delta: n.children.length - 1 });
      n.children.forEach(function(c) { walk(c, depth); });
    }
  }
  events.push({ time: 0, delta: (root.children ? root.children.length : 1) - 1 });
  if (root.children) root.children.forEach(function(c) { walk(c, 0); });
  events.sort(function(a, b) { return a.time - b.time; });
  var pts = [{ t: 0, n: 1 }];
  var lineages = 1;
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    pts.push({ t: ev.time, n: lineages });
    lineages += ev.delta;
    pts.push({ t: ev.time, n: lineages });
  }
  pts.push({ t: computeMaxDepth(root, 0), n: lineages });
  return pts;
}

function getAnnotationKeys(root) {
  const keys = new Set();
  function walk(n) {
    if (n.children && n.children.length) {
      if (n.annotations) Object.keys(n.annotations).forEach(function(k) { keys.add(k); });
      n.children.forEach(walk);
    }
  }
  walk(root);
  return Array.from(keys);
}

function hasInternalNodeLabels(root) {
  if (!root.children || !root.children.length) return false;
  if (root.name && root.name.trim()) return true;
  return root.children.some(hasInternalNodeLabels);
}

const NOTE_COLORS = [
  { fill: "#fef9c3", border: "#d97706", text: "#78350f" }, // amber
  { fill: "#dcfce7", border: "#16a34a", text: "#14532d" }, // green
  { fill: "#dbeafe", border: "#2563eb", text: "#1e3a8a" }, // blue
  { fill: "#fce7f3", border: "#db2777", text: "#831843" }, // pink
  { fill: "#ede9fe", border: "#7c3aed", text: "#3b0764" }, // purple
];

const CONTINUOUS_PALETTES = [
  { key: "viridis",  label: "Viridis",  fn: function(t) { return d3.interpolateViridis(t); } },
  { key: "magma",    label: "Magma",    fn: function(t) { return d3.interpolateMagma(t); } },
  { key: "inferno",  label: "Inferno",  fn: function(t) { return d3.interpolateInferno(t); } },
  { key: "plasma",   label: "Plasma",   fn: function(t) { return d3.interpolatePlasma(t); } },
  { key: "cividis",  label: "Cividis",  fn: function(t) { return d3.interpolateCividis(t); } },
  { key: "turbo",    label: "Turbo",    fn: function(t) { return d3.interpolateTurbo(t); } },
];

function paletteCSSGradient(fn) {
  return "linear-gradient(to right," + [0, 0.25, 0.5, 0.75, 1].map(fn).join(",") + ")";
}

// ── Trait data utilities ──────────────────────────────────────────────────────

function parseCSVRow(line) {
  const result = []; let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuote = !inQuote; }
    else if (line[i] === ',' && !inQuote) { result.push(cur.trim()); cur = ""; }
    else { cur += line[i]; }
  }
  result.push(cur.trim()); return result;
}

function parseTraitCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(function(l) { return l.trim(); });
  if (lines.length < 2) return null;
  const headers = parseCSVRow(lines[0]);
  if (headers.length < 2) return null;
  const traitCols = headers.slice(1);
  const rows = {};
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVRow(lines[i]);
    const tipName = vals[0]; if (!tipName) continue;
    const traitVals = {};
    traitCols.forEach(function(col, j) {
      const v = vals[j + 1];
      const isNA = v === undefined || v === "" || /^(NA|na|N\/A|n\/a|null|NULL|-)$/.test(v);
      traitVals[col] = isNA ? null : v;
    });
    rows[tipName] = traitVals;
  }
  return { traitCols, rows };
}

const TRAIT_PALETTE = ["#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f","#edc948","#b07aa1","#ff9da7","#9c755f","#bab0ac"];

function computeTraitMeta(traitCols, rows) {
  const meta = {};
  traitCols.forEach(function(col) {
    const values = Object.values(rows).map(function(r) { return r[col]; }).filter(function(v) { return v !== null; });
    const nums = values.map(Number);
    const isContinuous = values.length > 0 && nums.every(function(n) { return !isNaN(n); });
    if (isContinuous) {
      const min = Math.min.apply(null, nums), max = Math.max.apply(null, nums);
      const palFn = CONTINUOUS_PALETTES[0].fn;
      meta[col] = { type: "continuous", min, max, palette: "viridis",
        colorFn: function(v) { if (v === null) return null; const t = max === min ? 0.5 : (Number(v) - min) / (max - min); return palFn(t); }
      };
    } else {
      const categories = []; values.forEach(function(v) { if (!categories.includes(v)) categories.push(v); }); categories.sort();
      const colorMap = {}; categories.forEach(function(cat, i) { colorMap[cat] = TRAIT_PALETTE[i % TRAIT_PALETTE.length]; });
      meta[col] = { type: "discrete", categories, colorMap,
        colorFn: function(v) { return v === null ? null : (colorMap[v] || "#9ca3af"); }
      };
    }
  });
  return meta;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [treeData, setTreeData] = useState(null);
  const [history, setHistory] = useState([]);
  const [layout, setLayout] = useState("rectangular");
  const [selectedId, setSelectedId] = useState(null);
  const [multiSelected, setMultiSelected] = useState(new Set());
  const [newickInput, setNewickInput] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState("select");
  const [cladeSummary, setCladeSummary] = useState(null);
  const [fontSize, setFontSize] = useState(12);
  const [lineSize, setLineSize] = useState(1);
  const [flipAxis, setFlipAxis] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [leafCount, setLeafCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocusId, setSearchFocusId] = useState(null);
  const [cladeFocusId, setCladeFocusId] = useState(null);
  const [activePanel, setActivePanel] = useState("clade");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackEmail, setFeedbackEmail] = useState("");
  const [feedbackType, setFeedbackType] = useState("bug");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("idle"); // idle | sending | success | error
  const [traitData, setTraitData] = useState(null);
  const [traitMeta, setTraitMeta] = useState({});
  const [traitNames, setTraitNames] = useState([]);
  const [activeTraits, setActiveTraits] = useState([]);
  const [traitMatchCount, setTraitMatchCount] = useState({ matched: 0, total: 0 });
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [lttOpen, setLttOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(function() {
    return localStorage.getItem("phylo_seen_whats_new") !== "v0.4";
  });
  const [citeOpen, setCiteOpen] = useState(false);
  const [focusCladeId, setFocusCladeId] = useState(null);
  const [showNodeHeights, setShowNodeHeights] = useState(false);
  const [nodeHeightMode, setNodeHeightMode] = useState("from_root");
  const [showNodeLabels, setShowNodeLabels] = useState(false);
  const [activeNodeAnnotations, setActiveNodeAnnotations] = useState([]);
  const [nodeLabelFontSize, setNodeLabelFontSize] = useState(9);
  const [treeAnnotationKeys, setTreeAnnotationKeys] = useState([]);
  const [treeHasInternalLabels, setTreeHasInternalLabels] = useState(false);
  const [userAnnotations, setUserAnnotations] = useState({});
  const [showUserAnnotations, setShowUserAnnotations] = useState(true);
  const [noteInput, setNoteInput] = useState("");
  const [noteColorIdx, setNoteColorIdx] = useState(0);
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [dataTableOpen, setDataTableOpen] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [traitVersion, setTraitVersion] = useState(0);
  const [hiddenTraitCols, setHiddenTraitCols] = useState(new Set());
  const [traitRowSort, setTraitRowSort] = useState("tree");

  const openSource = function() { setSourceText(treeData ? toNewick(treeData) + ";" : ""); setSourceOpen(true); };
  const closeSource = function() { setSourceOpen(false); };
  const confirmSource = function() { loadTree(sourceText); setSourceOpen(false); };

  const handleTraitFile = function(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      const parsed = parseTraitCSV(ev.target.result);
      if (!parsed) return;
      const { traitCols, rows } = parsed;
      const meta = computeTraitMeta(traitCols, rows);
      setTraitData(rows); setTraitMeta(meta); setTraitNames(traitCols);
      setActiveTraits(traitCols.slice(0, 5));
      setTraitVersion(function(v) { return v + 1; });
      setHiddenTraitCols(new Set());
      if (treeData) {
        const leafNames = getLeafNames(treeData);
        setTraitMatchCount({ matched: leafNames.filter(function(n) { return rows[n] !== undefined; }).length, total: leafNames.length });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const clearTraits = function() { setTraitData(null); setTraitMeta({}); setTraitNames([]); setActiveTraits([]); setTraitMatchCount({ matched: 0, total: 0 }); setDataTableOpen(false); setHiddenTraitCols(new Set()); };

  const createTraitData = function() {
    if (!treeData) return;
    const leafNames = getLeafNames(treeData);
    if (!leafNames.length) return;
    const rows = {};
    leafNames.forEach(function(n) { rows[n] = {}; });
    setTraitData(rows);
    setTraitMeta({});
    setTraitNames([]);
    setActiveTraits([]);
    setTraitMatchCount({ matched: leafNames.length, total: leafNames.length });
    setTraitVersion(function(v) { return v + 1; });
    setHiddenTraitCols(new Set());
    setDataTableOpen(true);
  };

  const updateTraitPalette = function(traitName, paletteKey) {
    const pal = CONTINUOUS_PALETTES.find(function(p) { return p.key === paletteKey; }) || CONTINUOUS_PALETTES[0];
    setTraitMeta(function(prev) {
      const m = prev[traitName];
      if (!m || m.type !== "continuous") return prev;
      const min = m.min, max = m.max;
      return Object.assign({}, prev, {
        [traitName]: Object.assign({}, m, {
          palette: paletteKey,
          colorFn: function(v) { if (v === null) return null; const t = max === min ? 0.5 : (Number(v) - min) / (max - min); return pal.fn(t); }
        })
      });
    });
  };

  const handleCellEdit = function(tipName, colName, rawValue) {
    const trimmed = rawValue.trim();
    const value = trimmed === "" || /^(NA|na|N\/A|n\/a|null|NULL|-)$/.test(trimmed) ? null : trimmed;
    setTraitData(function(prev) {
      if (!prev || !prev[tipName]) return prev;
      return Object.assign({}, prev, { [tipName]: Object.assign({}, prev[tipName], { [colName]: value }) });
    });
  };

  const addTraitColumn = function() {
    const col = newColName.trim();
    if (!col || !traitData || traitNames.includes(col)) return;
    const newNames = traitNames.concat([col]);
    const newData = {};
    Object.keys(traitData).forEach(function(tip) { newData[tip] = Object.assign({}, traitData[tip], { [col]: null }); });
    setTraitNames(newNames);
    setTraitData(newData);
    setActiveTraits(function(prev) { return prev.concat([col]); });
    setNewColName("");
  };

  const exportTraitCSV = function() {
    if (!traitData || !traitNames.length) return;
    const esc = function(v) { const s = (v === null || v === undefined) ? "" : String(v); return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const treeLeaves = treeData ? getLeafNames(treeData) : [];
    const treeLeafSet = new Set(treeLeaves);
    const ordered = treeLeaves.filter(function(n) { return traitData[n]; }).concat(Object.keys(traitData).filter(function(n) { return !treeLeafSet.has(n); }));
    const csv = [["tip_labels"].concat(traitNames).map(esc).join(",")]
      .concat(ordered.map(function(tip) { return [tip].concat(traitNames.map(function(col) { return traitData[tip] ? traitData[tip][col] : null; })).map(esc).join(","); }))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "traits.csv"; a.click();
  };

  // Paste your Formspree endpoint here after creating a form at formspree.io
  const FORMSPREE_ENDPOINT = "https://formspree.io/f/xgorpzja";

  const openFeedback = function() { setFeedbackOpen(true); setFeedbackStatus("idle"); };
  const closeFeedback = function() { setFeedbackOpen(false); };

  const submitFeedback = async function() {
    if (!feedbackEmail.trim() || !feedbackMessage.trim()) return;
    setFeedbackStatus("sending");
    try {
      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ email: feedbackEmail, type: feedbackType, message: feedbackMessage }),
      });
      setFeedbackStatus(res.ok ? "success" : "error");
      if (res.ok) { setFeedbackEmail(""); setFeedbackType("bug"); setFeedbackMessage(""); }
    } catch(e) {
      setFeedbackStatus("error");
    }
  };

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const zoomTransformRef = useRef(d3.zoomIdentity);
  const zoomBehaviorRef = useRef(null);
  const rafRef = useRef(null);
  const sceneRef = useRef(null);
  const nodesRef = useRef([]);
  const nodePositionMapRef = useRef({});
  const treeDataRef = useRef(null);
  const selectedIdRef = useRef(null);
  const multiSelectedRef = useRef(new Set());
  const focusCladeIdRef = useRef(null);
  const tableContainerRef = useRef(null);
  const rowRefsMap = useRef({});

  const sampleNewick = "((((Homo_sapiens:0.007,Pan_troglodytes:0.007)100:0.003,Gorilla_gorilla:0.01)98:0.008,Pongo_pygmaeus:0.018)95:0.012,Macaca_mulatta:0.03)100;";

  useEffect(function() { treeDataRef.current = treeData; }, [treeData]);
  useEffect(function() { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(function() { multiSelectedRef.current = multiSelected; }, [multiSelected]);

  const pushHistory = function(t) { setHistory(function(h) { return h.slice(-20).concat([t]); }); };

  const loadTree = function(str) {
    let src = str.trim();
    if (/^#NEXUS/i.test(src)) {
      const converted = parseNexusToNewick(src);
      if (!converted) { setError("Could not parse NEXUS file — no valid TREE block found."); return; }
      src = converted;
    }
    const parsed = parseNewick(src);
    if (!parsed) { setError("Invalid Newick format."); return; }
    setError("");
    assignIds(parsed);
    setLeafCount(countLeaves(parsed));
    setTreeAnnotationKeys(getAnnotationKeys(parsed));
    setTreeHasInternalLabels(hasInternalNodeLabels(parsed));
    setActiveNodeAnnotations([]);
    setShowNodeHeights(false);
    setShowNodeLabels(false);
    setUserAnnotations({});
    setNoteInput("");
    setTreeData(parsed);
    setHistory([]);
    setSelectedId(null);
    setMultiSelected(new Set());
    setCladeSummary(null);
    setCladeFocusId(null);
    setSearchQuery("");
    zoomTransformRef.current = d3.zoomIdentity;
    setFocusCladeId(null);
  };

  const handleFile = function(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) { setNewickInput(ev.target.result); loadTree(ev.target.result); };
    reader.readAsText(file);
  };

  const undo = function() {
    if (!history.length) return;
    setTreeData(history[history.length - 1]);
    setHistory(function(h) { return h.slice(0, -1); });
    setSelectedId(null); setMultiSelected(new Set()); setCladeSummary(null);
  };

  const applyEdit = function(newTree) {
    setFocusCladeId(null);
    pushHistory(treeData);
    assignIds(newTree);
    setLeafCount(countLeaves(newTree));
    setTreeData(newTree);
    setSelectedId(null);
    setMultiSelected(new Set());
    setCladeSummary(null);
  };

  const doLadderize = function(asc) {
    if (!treeData) return;
    const t = cloneTree(treeData); ladderize(t, asc); applyEdit(t);
  };

  const doReroot = function(id) {
    if (!treeData) return; applyEdit(rerootTree(treeData, id));
  };

  const extractClade = function() {
    if (selectedId == null || !treeData) return;
    const n = findNode(treeData, selectedId); if (!n) return;
    const t = cloneTree(n); t.length = null;
    zoomTransformRef.current = d3.zoomIdentity;
    applyEdit(t);
  };

  const deleteClade = function() {
    if (selectedId == null || !treeData || treeData._id === selectedId) return;
    const t = cloneTree(treeData);
    function del(n) {
      if (!n.children) return;
      n.children = n.children.filter(function(c) { return c._id !== selectedId; });
      n.children.forEach(del);
    }
    del(t); applyEdit(t);
  };

  const toggleCollapse = function() {
    if (selectedId == null || !treeData) return;
    const t = cloneTree(treeData);
    const n = findNode(t, selectedId);
    if (n) n._collapsed = !n._collapsed;
    pushHistory(treeData); setTreeData(t);
  };

  const collapseOthers = function() {
    if (selectedId == null || !treeData) return;
    setFocusCladeId(selectedId);
  };

  const doRename = function(newName) {
    if (!treeData || !selectedId || !newName.trim()) return;
    const next = cloneTree(treeData);
    const n = findNode(next, selectedId);
    if (!n) return;
    n.name = newName.trim();
    applyEdit(next);
    setRenameValue("");
  };

  const doExport = function(includeNotes) {
    setExportDialogOpen(false);
    let tree = treeData;
    if (includeNotes && Object.keys(userAnnotations).length > 0) {
      tree = cloneTree(treeData);
      function applyNotes(n) {
        const ann = userAnnotations[n._id];
        if (ann) n.annotations = Object.assign({}, n.annotations || {}, { note: '"' + ann.text.replace(/"/g, "'") + '"' });
        if (n.children) n.children.forEach(applyNotes);
      }
      applyNotes(tree);
    }
    const blob = new Blob([toNewick(tree) + ";"], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "tree.nwk"; a.click();
  };

  const exportNewick = function() {
    if (!treeData) return;
    if (Object.keys(userAnnotations).length > 0) { setExportDialogOpen(true); return; }
    doExport(false);
  };

  const saveNote = function() {
    if (selectedId == null) return;
    const trimmed = noteInput.trim();
    setUserAnnotations(function(prev) {
      const next = Object.assign({}, prev);
      if (trimmed) next[selectedId] = { text: trimmed, colorIdx: noteColorIdx };
      else delete next[selectedId];
      return next;
    });
  };

  const deleteNote = function() {
    if (selectedId == null) return;
    setUserAnnotations(function(prev) { const next = Object.assign({}, prev); delete next[selectedId]; return next; });
    setNoteInput("");
    setNoteColorIdx(0);
  };

  const extractMultiTips = function() {
    if (!treeData || multiSelected.size === 0) return;
    const leafIdsToKeep = new Set();
    multiSelected.forEach(function(id) {
      const n = findNode(treeData, id);
      if (!n) return;
      if (!n.children || !n.children.length) leafIdsToKeep.add(id);
      else getLeafIds(n).forEach(function(lid) { leafIdsToKeep.add(lid); });
    });
    if (leafIdsToKeep.size === 0) return;
    const t = cloneTree(treeData);
    function pruneTo(n) {
      if (!n.children || !n.children.length) return leafIdsToKeep.has(n._id) ? n : null;
      n.children = n.children.map(pruneTo).filter(Boolean);
      if (n.children.length === 0) return null;
      if (n.children.length === 1) {
        const child = n.children[0];
        child.length = (child.length || 0) + (n.length || 0);
        return child;
      }
      return n;
    }
    const pruned = pruneTo(t);
    if (!pruned) return;
    setMultiSelected(new Set());
    applyEdit(pruned);
  };

  const deleteMultiTips = function() {
    if (!treeData) return;
    const leafIdsToDelete = new Set();
    multiSelected.forEach(function(id) {
      const n = findNode(treeData, id);
      if (!n) return;
      if (!n.children || !n.children.length) leafIdsToDelete.add(id);
      else getLeafIds(n).forEach(function(lid) { leafIdsToDelete.add(lid); });
    });
    if (leafIdsToDelete.size === 0) return;
    const t = cloneTree(treeData);
    function delTips(n) {
      if (!n.children || !n.children.length) return leafIdsToDelete.has(n._id) ? null : n;
      n.children = n.children.map(delTips).filter(Boolean);
      if (n.children.length === 0) return null;
      if (n.children.length === 1) {
        const child = n.children[0];
        child.length = (child.length || 0) + (n.length || 0);
        return child;
      }
      return n;
    }
    const pruned = delTips(t);
    if (!pruned) return;
    setDeleteConfirm(false);
    setMultiSelected(new Set());
    applyEdit(pruned);
  };

  const tipsToDeleteCount = treeData ? (function() {
    const ids = new Set();
    multiSelected.forEach(function(id) {
      const n = findNode(treeData, id);
      if (!n) return;
      if (!n.children || !n.children.length) ids.add(id);
      else getLeafIds(n).forEach(function(lid) { ids.add(lid); });
    });
    return ids.size;
  })() : 0;

  useEffect(function() {
    if (selectedId == null || !treeData) { setCladeSummary(null); return; }
    const n = findNode(treeData, selectedId);
    if (!n) { setCladeSummary(null); return; }
    setCladeSummary({ tips: getLeafNames(n), sumBL: sumBranchLengths(n), height: nodeHeight(n), name: n.name, branchLength: n.length });
  }, [selectedId, treeData]);

  const searchMatches = (function() {
    if (!searchQuery.trim() || !sceneRef.current) return [];
    const q = searchQuery.toLowerCase();
    return sceneRef.current.nodes
      .filter(function(ni) { return ni.isLeaf && ni.name && ni.name.toLowerCase().includes(q); })
      .map(function(ni) { return { id: ni.id, name: ni.name, localX: ni.localX, localY: ni.localY }; });
  })();
  const searchMatchIds = new Set(searchMatches.map(function(m) { return m.id; }));

  const snapToId = function(id) {
    setTimeout(function() {
      const pos = nodePositionMapRef.current[id];
      const canvas = canvasRef.current;
      const zoomBehavior = zoomBehaviorRef.current;
      const scene = sceneRef.current;
      if (!pos || !canvas || !zoomBehavior || !scene) return;
      const W = canvas.width, H = canvas.height;
      const targetK = Math.max(zoomTransformRef.current.k, 4);
      const newT = d3.zoomIdentity
        .translate(W / 2 - scene.originX, H / 2 - scene.originY)
        .scale(targetK)
        .translate(-pos.localX, -pos.localY);
      d3.select(canvas).transition().duration(600).call(zoomBehavior.transform, newT);
    }, 50);
  };

  const snapToNode = function(ni) {
    const canvas = canvasRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    const scene = sceneRef.current;
    if (!canvas || !zoomBehavior || !scene) return;
    const W = canvas.width, H = canvas.height;
    const targetK = Math.max(zoomTransformRef.current.k, 4);
    const newT = d3.zoomIdentity
      .translate(W / 2 - scene.originX, H / 2 - scene.originY)
      .scale(targetK)
      .translate(-ni.localX, -ni.localY);
    d3.select(canvas).transition().duration(600).call(zoomBehavior.transform, newT);
  };

  const drawScene = function(transform, matchIds, multiSel) {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene) return;
    const W = scene.W, H = scene.H, links = scene.links, nodes = scene.nodes;
    const originX = scene.originX, originY = scene.originY;
    const useBL = scene.useBL, maxDepth = scene.maxDepth, tw = scene.tw, margin = scene.margin;
    const scLayout = scene.layout, selDescIds = scene.selDescIds, sid = scene.selectedId;
    const fa = scene.flipAxis, sfid = scene.searchFocusId, cfid = scene.cladeFocusId;
    const connectingBranches = scene.connectingBranches;
    const focusDescIds = scene.focusDescIds;
    const k = transform.k, x = transform.x, y = transform.y;
    const mIds = matchIds || new Set();
    const ms = multiSel || new Set();
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    const sx = function(lx) { return lx * k + originX + x; };
    const sy = function(ly) { return ly * k + originY + y; };

    const ls = scene.lineSize || 1;
    links.forEach(function(lk) {
      if (focusDescIds && !(focusDescIds.has(lk.srcId) && focusDescIds.has(lk.tgtId))) return;
      const isSel = lk.tgtId === sid;
      const inClade = selDescIds.has(lk.srcId) && selDescIds.has(lk.tgtId);
      const isMultiNode = ms.has(lk.tgtId);
      const isConn = connectingBranches.has(lk.tgtId);
      ctx.beginPath();
      ctx.strokeStyle = isSel ? "#f59e0b" : isMultiNode ? "#8b5cf6" : isConn ? "#a78bfa" : inClade ? "#2563eb" : "#d1d5db";
      ctx.lineWidth = (isSel ? 2.5 : (isMultiNode || isConn) ? 2.5 : inClade ? 2 : 1) * ls;
      if (scLayout === "rectangular") {
        ctx.moveTo(sx(lk.sx), sy(lk.sy)); ctx.lineTo(sx(lk.sx), sy(lk.ty)); ctx.lineTo(sx(lk.tx), sy(lk.ty));
      } else {
        ctx.moveTo(sx(lk.sx), sy(lk.sy)); ctx.lineTo(sx(lk.tx), sy(lk.ty));
      }
      ctx.stroke();
    });

    const circleR = 3 * ls;
    const gap = circleR + 3;
    const autoShow = k > (scene.leafCount > 500 ? 500 / scene.leafCount : 0.3);
    const showLbls = scene.showLabels && autoShow;

    // Pre-compute visible min/max for continuous traits based on currently visible leaf tips
    const visibleTraitRanges = {};
    if (scene.traitData && scene.activeTraits && scene.activeTraits.length > 0) {
      scene.activeTraits.forEach(function(traitName) {
        const tm = scene.traitMeta[traitName];
        if (!tm || tm.type !== "continuous") return;
        const vals = [];
        nodes.forEach(function(ni) {
          if (focusDescIds && !focusDescIds.has(ni.id)) return;
          if (!ni.isLeaf || ni.collapsed) return;
          const tv = scene.traitData[ni.name] ? scene.traitData[ni.name][traitName] : null;
          if (tv !== null && tv !== undefined) vals.push(Number(tv));
        });
        if (vals.length > 0) visibleTraitRanges[traitName] = { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) };
      });
    }
    function traitColor(traitName, tv) {
      const tm = scene.traitMeta[traitName];
      if (!tm || tv === null || tv === undefined) return null;
      if (tm.type === "discrete") return tm.colorFn(tv);
      const range = visibleTraitRanges[traitName];
      const vmin = range ? range.min : tm.min;
      const vmax = range ? range.max : tm.max;
      const t = vmax === vmin ? 0.5 : (Number(tv) - vmin) / (vmax - vmin);
      return (CONTINUOUS_PALETTES.find(function(p) { return p.key === (tm.palette || "viridis"); }) || CONTINUOUS_PALETTES[0]).fn(t);
    }

    nodes.forEach(function(ni) {
      if (focusDescIds && !focusDescIds.has(ni.id)) return;
      const screenX = sx(ni.localX), screenY = sy(ni.localY);
      if (screenX < -20 || screenX > W + 20 || screenY < -20 || screenY > H + 20) return;
      const isMatch = mIds.has(ni.id);
      const isFocus = ni.id === sfid || ni.id === cfid;
      const inClade = selDescIds.has(ni.id);
      const isMultiSel = ms.has(ni.id);
      const isConn = connectingBranches.has(ni.id) && !isMultiSel;

      // Trait colour for leaf nodes in radial view (first active trait)
      let traitNodeColor = null;
      if (ni.isLeaf && scLayout === "radial" && scene.activeTraits && scene.activeTraits.length > 0) {
        const tm = scene.traitMeta[scene.activeTraits[0]];
        const tv = scene.traitData && ni.name && scene.traitData[ni.name] ? scene.traitData[ni.name][scene.activeTraits[0]] : null;
        if (tm && tv !== null) traitNodeColor = traitColor(scene.activeTraits[0], tv);
      }

      ctx.beginPath();
      ctx.arc(screenX, screenY, (ni.selected || isMatch || isFocus || isMultiSel) ? circleR + 2 : circleR, 0, 2 * Math.PI);
      ctx.fillStyle = ni.selected ? "#2563eb" : isFocus ? "#dc2626" : isMatch ? "#ef4444"
        : isMultiSel ? "#7c3aed" : isConn ? "#a78bfa" : inClade ? "#93c5fd"
        : ni.collapsed ? "#f59e0b"
        : (traitNodeColor || (ni.isLeaf ? "#374151" : "#9ca3af"));
      ctx.fill();
      ctx.strokeStyle = (isFocus || isMultiSel) ? "#fff" : ni.selected ? "#1d4ed8" : "#fff";
      ctx.lineWidth = ((isFocus || isMultiSel) ? 2 : 1.2) * ls;
      ctx.stroke();

      // Trait squares — rectangular layout only, leaf nodes only, drawn between node and label
      const sqSz = scene.fontSize;
      const sqPad = 2;
      const hasTraitSqs = ni.isLeaf && scLayout === "rectangular" && scene.activeTraits && scene.activeTraits.length > 0;
      const traitBlockW = hasTraitSqs ? scene.activeTraits.length * (sqSz + sqPad) + 2 : 0;

      if (hasTraitSqs) {
        const sqStart = screenX + gap;
        scene.activeTraits.forEach(function(traitName, ti) {
          const tm = scene.traitMeta[traitName]; if (!tm) return;
          const tv = scene.traitData && ni.name && scene.traitData[ni.name] ? scene.traitData[ni.name][traitName] : null;
          const color = traitColor(traitName, tv);
          const x = sqStart + ti * (sqSz + sqPad);
          ctx.fillStyle = color || "#e5e7eb";
          ctx.fillRect(x, screenY - sqSz / 2, sqSz, sqSz);
          ctx.strokeStyle = "rgba(0,0,0,0.1)";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(x, screenY - sqSz / 2, sqSz, sqSz);
        });
      }

      const showThisName = ni.isLeaf || ni.collapsed || (scene.showNodeLabels && !ni.isLeaf);
      if ((showLbls || isMatch || isFocus || isMultiSel) && showThisName && (ni.name || ni.collapsed)) {
        const label = ni.collapsed ? "[" + (ni.name || "clade") + " ►]" : ni.name || "";
        const goRight = scLayout === "radial" ? (ni.angle < Math.PI) === ni.isLeaf : ni.isLeaf;
        const lx = screenX + (goRight ? gap + traitBlockW : -gap);
        ctx.font = ((isFocus || isMatch || inClade || isMultiSel) ? "700 " : "") + scene.fontSize + "px system-ui, sans-serif";
        ctx.textAlign = goRight ? "left" : "right";
        ctx.textBaseline = "middle";
        if (isFocus || isMultiSel) {
          const labelW = ctx.measureText(label).width;
          const bx = goRight ? lx - 2 : lx - labelW - 2;
          ctx.save();
          ctx.fillStyle = isFocus ? "#fef08a" : "#ede9fe";
          ctx.fillRect(bx, screenY - scene.fontSize / 2 - 2, labelW + 4, scene.fontSize + 4);
          ctx.restore();
        }
        ctx.fillStyle = isFocus ? "#dc2626" : isMatch ? "#ef4444" : isMultiSel ? "#7c3aed" : inClade ? "#1d4ed8" : "#374151";
        ctx.fillText(label, lx, screenY);
      }

      // Node label (height / support / annotations) — internal nodes only
      if (!ni.isLeaf) {
        const nlParts = [];
        if (scene.showNodeHeights && scene.hasBL) {
          const raw = ni.depthFromRoot || 0;
          const disp = scene.nodeHeightMode === "before_present" ? scene.maxDepth - raw : raw;
          nlParts.push(+disp.toPrecision(4));
        }
        if (scene.activeNodeAnnotations && scene.activeNodeAnnotations.length > 0 && ni.annotations) {
          scene.activeNodeAnnotations.forEach(function(key) {
            const v = ni.annotations[key];
            if (v !== undefined && v !== null && v !== "") nlParts.push(v);
          });
        }
        if (nlParts.length > 0) {
          const nlabel = nlParts.join(" | ");
          ctx.save();
          ctx.font = scene.fontSize + "px system-ui, sans-serif";
          ctx.fillStyle = "#6b7280";
          ctx.textBaseline = "bottom";
          if (scLayout === "rectangular") {
            ctx.textAlign = "left";
            ctx.fillText(nlabel, screenX + circleR + 2, screenY - 1);
          } else {
            ctx.textAlign = "center";
            ctx.fillText(nlabel, screenX, screenY - circleR - 2);
          }
          ctx.restore();
        }
      }

      // User annotation sticky-note box
      if (scene.showUserAnnotations && scene.userAnnotations && scene.userAnnotations[ni.id]) {
        const noteData = scene.userAnnotations[ni.id];
        const note = noteData.text || noteData; // back-compat if string
        const nc = NOTE_COLORS[noteData.colorIdx || 0] || NOTE_COLORS[0];
        ctx.save();
        const noteFont = "bold " + Math.max(10, scene.fontSize - 1) + "px system-ui, sans-serif";
        ctx.font = noteFont;
        const pad = 7, lineH = scene.fontSize + 2, maxTxtW = 130;
        // word-wrap
        const rawLines = note.split("\n");
        const wrappedLines = [];
        rawLines.forEach(function(para) {
          if (!para.trim()) { wrappedLines.push(""); return; }
          const words = para.split(" ");
          let cur = "";
          words.forEach(function(w) {
            const test = cur ? cur + " " + w : w;
            if (ctx.measureText(test).width > maxTxtW) { if (cur) wrappedLines.push(cur); cur = w; }
            else cur = test;
          });
          if (cur) wrappedLines.push(cur);
        });
        const textW = Math.min(maxTxtW, Math.max.apply(null, wrappedLines.map(function(l) { return ctx.measureText(l || " ").width; })));
        const boxW = textW + pad * 2;
        const boxH = wrappedLines.length * lineH + pad * 2;
        const bx = screenX + circleR + 12;
        const by = Math.max(4, screenY - boxH - circleR - 6);
        // Connector line
        ctx.beginPath();
        ctx.moveTo(screenX, screenY - circleR);
        ctx.lineTo(bx, by + boxH);
        ctx.strokeStyle = nc.border;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Box shadow (soft)
        ctx.shadowColor = "rgba(0,0,0,0.12)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        // Rounded rect
        const r = 5;
        ctx.beginPath();
        ctx.moveTo(bx + r, by);
        ctx.lineTo(bx + boxW - r, by);
        ctx.arcTo(bx + boxW, by, bx + boxW, by + r, r);
        ctx.lineTo(bx + boxW, by + boxH - r);
        ctx.arcTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH, r);
        ctx.lineTo(bx + r, by + boxH);
        ctx.arcTo(bx, by + boxH, bx, by + boxH - r, r);
        ctx.lineTo(bx, by + r);
        ctx.arcTo(bx, by, bx + r, by, r);
        ctx.closePath();
        ctx.fillStyle = nc.fill;
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.strokeStyle = nc.border;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Text
        ctx.fillStyle = nc.text;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        wrappedLines.forEach(function(line, li) {
          ctx.fillText(line, bx + pad, by + pad + li * lineH);
        });
        ctx.restore();
      }
    });

    if (scLayout === "rectangular" && useBL) {
      const axY = H - margin.bottom + 20;
      const axX0 = margin.left;
      const tipScreenX = tw * k + originX + x;
      const axRight = Math.min(tipScreenX, axX0 + tw);
      const axWidth = axRight - axX0;
      if (axWidth > 10) {
        const screenToBL = function(s) { return ((s - originX - x) / k) / tw * maxDepth; };
        const blLeft = screenToBL(axX0);
        const blRight = screenToBL(axRight);
        const toDisplay = function(bl) { return fa ? maxDepth - bl : bl; };
        const axisScale = d3.scaleLinear().domain([toDisplay(blLeft), toDisplay(blRight)]).range([axX0, axRight]);
        ctx.save();
        ctx.strokeStyle = "#9ca3af"; ctx.lineWidth = 1;
        ctx.fillStyle = "#6b7280"; ctx.font = "10px system-ui, sans-serif"; ctx.textBaseline = "top";
        ctx.beginPath(); ctx.moveTo(axX0, axY); ctx.lineTo(axRight, axY); ctx.stroke();
        axisScale.ticks(6).forEach(function(t) {
          const px = axisScale(t);
          if (px < axX0 || px > axRight) return;
          ctx.beginPath(); ctx.moveTo(px, axY); ctx.lineTo(px, axY + 5); ctx.stroke();
          ctx.textAlign = "center"; ctx.fillText(+t.toPrecision(4), px, axY + 7);
        });
        ctx.textAlign = "center"; ctx.fillStyle = "#9ca3af"; ctx.font = "11px system-ui, sans-serif";
        ctx.fillText(fa ? "time before present" : "branch length", axX0 + axWidth / 2, axY + 22);
        ctx.restore();
      }
    }
  };

  const scheduleRender = function(transform) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(function() { drawScene(transform, searchMatchIds, multiSelected); });
  };

  useEffect(function() {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!treeData || !container || !canvas) return;

    const W = container.clientWidth || 800;
    const H = container.clientHeight || 600;
    canvas.width = W; canvas.height = H;

    const margin = { top: 30, right: 160, bottom: 50, left: 60 };
    const tw = W - margin.left - margin.right;
    const th = H - margin.top - margin.bottom;
    const useBL = layout === "rectangular" && hasBranchLengths(treeData);
    const nLeaves = countLeaves(treeData);
    const logicalH = Math.max(th, nLeaves * 16);

    function buildH(n) {
      const d = Object.assign({}, n);
      if (n._collapsed || !n.children || !n.children.length) d.children = undefined;
      else d.children = n.children.map(buildH);
      return d;
    }

    const hier = d3.hierarchy(buildH(treeData));
    const selDescIds = selectedId != null ? (function() {
      const sn = findNode(treeData, selectedId);
      return sn ? getDescendantIds(sn) : new Set();
    })() : new Set();

    const connectingBranches = computeConnectingBranches(treeData, multiSelected);
    const hasBL = hasBranchLengths(treeData);

    let root, originX, originY, maxDepth = 0;
    let links = [], nodes = [];

    if (layout === "rectangular") {
      originX = margin.left; originY = margin.top;
      maxDepth = computeMaxDepth(treeData);
      if (useBL) {
        const xScale = d3.scaleLinear().domain([0, maxDepth]).range([0, tw]);
        root = d3.cluster().size([logicalH, tw])(hier);
        function setCumX(n, px) {
          if (!px) px = 0;
          n.y = xScale(px + (n.data.length || 0));
          n._cd = px + (n.data.length || 0);
          if (n.children) n.children.forEach(function(c) { setCumX(c, n._cd); });
        }
        setCumX(root, 0);
      } else {
        root = d3.tree().size([logicalH, tw])(hier);
      }
      links = root.links().map(function(d) {
        return { sx: d.source.y, sy: d.source.x, tx: d.target.y, ty: d.target.x, srcId: d.source.data._id, tgtId: d.target.data._id };
      });
      nodes = root.descendants().map(function(d) {
        return { id: d.data._id, localX: d.y, localY: d.x, isLeaf: !d.children, name: d.data.name, angle: null, collapsed: d.data._collapsed, inClade: selDescIds.has(d.data._id), selected: d.data._id === selectedId, annotations: d.data.annotations || null, depthFromRoot: d._cd !== undefined ? d._cd : 0 };
      });
    } else {
      const r = Math.min(W, H) / 2 - 80;
      originX = W / 2; originY = H / 2;
      root = d3.cluster().size([2 * Math.PI, r])(hier);
      // Build depth map for radial (needed for node height display)
      const depthMap = {};
      (function buildDM(d, acc) {
        const dep = acc + (d.data.length || 0);
        depthMap[d.data._id] = dep;
        if (d.children) d.children.forEach(function(c) { buildDM(c, dep); });
      })(root, 0);
      links = root.links().map(function(d) {
        const sp = d3.pointRadial(d.source.x, d.source.y);
        const tp = d3.pointRadial(d.target.x, d.target.y);
        return { sx: sp[0], sy: sp[1], tx: tp[0], ty: tp[1], srcId: d.source.data._id, tgtId: d.target.data._id };
      });
      nodes = root.descendants().map(function(d) {
        const p = d3.pointRadial(d.x, d.y);
        return { id: d.data._id, localX: p[0], localY: p[1], isLeaf: !d.children, name: d.data.name, angle: d.x, collapsed: d.data._collapsed, inClade: selDescIds.has(d.data._id), selected: d.data._id === selectedId, annotations: d.data.annotations || null, depthFromRoot: depthMap[d.data._id] || 0 };
      });
    }

    sceneRef.current = { W, H, links, nodes, originX, originY, useBL, hasBL, maxDepth, tw, margin, layout, selDescIds, selectedId, fontSize, lineSize, flipAxis, showLabels, leafCount: nLeaves, searchFocusId, cladeFocusId, connectingBranches, traitData, traitMeta, activeTraits, showNodeHeights, nodeHeightMode, showNodeLabels, activeNodeAnnotations, nodeLabelFontSize, userAnnotations, showUserAnnotations, focusCladeId: null, focusDescIds: null };
    const fci = focusCladeIdRef.current;
    if (fci != null) { const fn = findNode(treeData, fci); sceneRef.current.focusCladeId = fci; sceneRef.current.focusDescIds = fn ? getDescendantIds(fn) : null; }
    nodesRef.current = nodes;
    nodes.forEach(function(n) { nodePositionMapRef.current[n.id] = { localX: n.localX, localY: n.localY }; });

    function hitTest(ex, ey, transform) {
      const k = transform.k, x = transform.x, y = transform.y;
      const fds = sceneRef.current ? sceneRef.current.focusDescIds : null;
      for (let i = 0; i < nodes.length; i++) {
        const ni = nodes[i];
        if (fds && !fds.has(ni.id)) continue;
        const sx = ni.localX * k + originX + x, sy = ni.localY * k + originY + y;
        if ((ex - sx) * (ex - sx) + (ey - sy) * (ey - sy) < 100) return ni.id;
      }
      for (let i = 0; i < links.length; i++) {
        const lk = links[i];
        const lsx = lk.sx * k + originX + x, lsy = lk.sy * k + originY + y;
        const ltx = lk.tx * k + originX + x, lty = lk.ty * k + originY + y;
        if (layout === "rectangular") {
          if (Math.abs(ey - lty) < 8 && ex >= Math.min(lsx, ltx) - 4 && ex <= Math.max(lsx, ltx) + 4) return lk.tgtId;
          if (Math.abs(ex - lsx) < 8 && ey >= Math.min(lsy, lty) - 4 && ey <= Math.max(lsy, lty) + 4) return lk.tgtId;
        } else {
          const mx = (lsx + ltx) / 2, my = (lsy + lty) / 2;
          if (Math.abs(ex - mx) < 10 && Math.abs(ey - my) < 10) return lk.tgtId;
        }
      }
      return null;
    }

    const t0 = zoomTransformRef.current;
    scheduleRender(t0);

    const zoom = d3.zoom().scaleExtent([0.01, 200]).on("zoom", function(e) {
      zoomTransformRef.current = e.transform;
      scheduleRender(e.transform);
    });
    zoomBehaviorRef.current = zoom;

    const sel = d3.select(canvas);

    sel.on("click.tree", function(event) {
      const pos = d3.pointer(event);
      const ex = pos[0], ey = pos[1];
      const t = zoomTransformRef.current;
      const k = t.k, x = t.x, y = t.y;
      const isCmd = event.metaKey || event.ctrlKey;
      const isShift = event.shiftKey;

      let hit = hitTest(ex, ey, t);

      if (hit == null) {
        const ctx = canvas.getContext("2d");
        const fs = sceneRef.current ? sceneRef.current.fontSize : 12;
        const ls = sceneRef.current ? (sceneRef.current.lineSize || 1) : 1;
        const circleR = 3 * ls, gap = circleR + 3;
        const fds2 = sceneRef.current ? sceneRef.current.focusDescIds : null;
        for (let i = 0; i < nodesRef.current.length; i++) {
          const ni = nodesRef.current[i];
          if (fds2 && !fds2.has(ni.id)) continue;
          if (!ni.name) continue;
          const screenX = ni.localX * k + originX + x;
          const screenY = ni.localY * k + originY + y;
          if (screenX < -300 || screenX > W + 300 || screenY < -20 || screenY > H + 20) continue;
          const goRight = layout === "radial" ? (ni.angle < Math.PI) === ni.isLeaf : ni.isLeaf;
          const label = ni.collapsed ? "[" + ni.name + " ►]" : ni.name;
          ctx.font = fs + "px system-ui, sans-serif";
          const textW = ctx.measureText(label).width;
          const sc = sceneRef.current;
          const tBlockW = (ni.isLeaf && layout === "rectangular" && sc && sc.activeTraits && sc.activeTraits.length > 0)
            ? sc.activeTraits.length * (fs + 2) + 2 : 0;
          const lx0 = goRight ? screenX + gap + tBlockW : screenX - gap - textW;
          const lx1 = goRight ? screenX + gap + tBlockW + textW : screenX - gap;
          if (ex >= lx0 && ex <= lx1 && ey >= screenY - fs / 2 - 2 && ey <= screenY + fs / 2 + 2) {
            hit = ni.id; break;
          }
        }
      }

      if (hit != null) {
        if (mode === "reroot") { doReroot(hit); setMode("select"); return; }
        if (isCmd) {
          setMultiSelected(function(prev) {
            let base;
            if (prev.size === 0 && selectedId != null) {
              const selNode = findNode(treeData, selectedId);
              if (selNode) {
                const leafIds = getLeafIds(selNode);
                base = new Set(leafIds.length > 0 ? leafIds : [selectedId]);
              } else {
                base = new Set();
              }
            } else {
              base = new Set(prev);
            }
            if (base.has(hit)) base.delete(hit); else base.add(hit);
            return base;
          });
          setSelectedId(null);
        } else if (isShift && (selectedId != null || multiSelected.size > 0)) {
          const baseIds = new Set(multiSelected);
          if (selectedId != null) baseIds.add(selectedId);
          baseIds.add(hit);
          const mrcaId = findMRCA(treeData, baseIds);
          if (mrcaId != null) {
            setSelectedId(mrcaId);
            setMultiSelected(new Set());
          }
        } else {
          setSelectedId(function(prev) { return prev === hit ? null : hit; });
          setMultiSelected(new Set());
        }
      } else {
        setSelectedId(null);
        setMultiSelected(new Set());
      }
    });

    const handleKey = function(e) {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space" && treeData) {
        e.preventDefault();
        zoomTransformRef.current = d3.zoomIdentity;
        sel.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
      }
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code) && treeData) {
        e.preventDefault();
        var PAN = 60;
        var t = zoomTransformRef.current;
        var dx = e.code === "ArrowLeft" ? PAN : e.code === "ArrowRight" ? -PAN : 0;
        var dy = e.code === "ArrowUp" ? PAN : e.code === "ArrowDown" ? -PAN : 0;
        var newT = d3.zoomIdentity.translate(t.x + dx, t.y + dy).scale(t.k);
        zoomTransformRef.current = newT;
        zoomBehaviorRef.current.transform(d3.select(canvas), newT);
      }
    };
    window.addEventListener("keydown", handleKey);
    sel.call(zoom).call(zoom.transform, t0);
    canvas.addEventListener("wheel", function(event) {
      if (!event.shiftKey) return;
      event.preventDefault();
      var t = zoomTransformRef.current;
      var delta = -event.deltaY;
      var newT = (event.metaKey || event.ctrlKey)
        ? d3.zoomIdentity.translate(t.x + delta, t.y).scale(t.k)
        : d3.zoomIdentity.translate(t.x, t.y + delta).scale(t.k);
      zoomTransformRef.current = newT;
      zoomBehaviorRef.current.transform(d3.select(canvas), newT);
    }, { passive: false });

    return function() { sel.on(".tree", null); sel.on(".zoom", null); window.removeEventListener("keydown", handleKey); };
  }, [treeData, layout, selectedId, multiSelected, mode, fontSize, flipAxis, showLabels]);

  useEffect(function() {
    if (sceneRef.current) scheduleRender(zoomTransformRef.current);
  }, [searchQuery, searchFocusId, cladeFocusId]);

  useEffect(function() {
    if (sceneRef.current) {
      sceneRef.current.traitData = traitData;
      sceneRef.current.traitMeta = traitMeta;
      sceneRef.current.activeTraits = activeTraits;
      scheduleRender(zoomTransformRef.current);
    }
  }, [traitData, traitMeta, activeTraits]);

  useEffect(function() {
    if (sceneRef.current) {
      sceneRef.current.lineSize = lineSize;
      scheduleRender(zoomTransformRef.current);
    }
  }, [lineSize]);

  useEffect(function() {
    focusCladeIdRef.current = focusCladeId;
    if (sceneRef.current) {
      const fn = focusCladeId != null && treeData ? findNode(treeData, focusCladeId) : null;
      const descIds = fn ? getDescendantIds(fn) : null;
      sceneRef.current.focusCladeId = focusCladeId;
      sceneRef.current.focusDescIds = descIds;
      scheduleRender(zoomTransformRef.current);
    }
  }, [focusCladeId]);

  useEffect(function() {
    if (sceneRef.current) {
      sceneRef.current.showNodeHeights = showNodeHeights;
      sceneRef.current.nodeHeightMode = nodeHeightMode;
      sceneRef.current.showNodeLabels = showNodeLabels;
      sceneRef.current.activeNodeAnnotations = activeNodeAnnotations;
      sceneRef.current.nodeLabelFontSize = nodeLabelFontSize;
      scheduleRender(zoomTransformRef.current);
    }
  }, [showNodeHeights, nodeHeightMode, showNodeLabels, activeNodeAnnotations, nodeLabelFontSize]);

  useEffect(function() {
    const existing = selectedId != null ? userAnnotations[selectedId] : null;
    setNoteInput(existing ? existing.text : "");
    setNoteColorIdx(existing ? (existing.colorIdx || 0) : 0);
  }, [selectedId]);

  useEffect(function() {
    if (sceneRef.current) {
      sceneRef.current.userAnnotations = userAnnotations;
      sceneRef.current.showUserAnnotations = showUserAnnotations;
      scheduleRender(zoomTransformRef.current);
    }
  }, [userAnnotations, showUserAnnotations]);

  useEffect(function() {
    if (!dataTableOpen || selectedId == null) return;
    const td = treeDataRef.current;
    if (!td) return;
    const node = findNode(td, selectedId);
    if (!node || (node.children && node.children.length > 0)) return;
    const tipName = node.name;
    if (!tipName) return;
    const rowEl = rowRefsMap.current[tipName];
    if (rowEl) rowEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId, dataTableOpen]);

  useEffect(function() {
    if (!traitData || !traitNames.length) return;
    const newMeta = computeTraitMeta(traitNames, traitData);
    setTraitMeta(function(prevMeta) {
      traitNames.forEach(function(col) {
        if (prevMeta[col] && newMeta[col] && prevMeta[col].type === "continuous" && newMeta[col].type === "continuous" && prevMeta[col].palette) {
          const pal = CONTINUOUS_PALETTES.find(function(p) { return p.key === prevMeta[col].palette; }) || CONTINUOUS_PALETTES[0];
          const min = newMeta[col].min, max = newMeta[col].max;
          newMeta[col] = Object.assign({}, newMeta[col], {
            palette: prevMeta[col].palette,
            colorFn: function(v) { if (v === null) return null; const t = max === min ? 0.5 : (Number(v) - min) / (max - min); return pal.fn(t); }
          });
        }
      });
      return newMeta;
    });
  }, [traitData, traitNames]);

  const selectedNode = selectedId != null && treeData ? findNode(treeData, selectedId) : null;
  const multiNodes = treeData ? Array.from(multiSelected).map(function(id) { return findNode(treeData, id); }).filter(Boolean) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif", background: "#f9fafb", color: "#111827" }}>

      <div style={{ padding: "10px 16px", borderBottom: "1px solid #e5e7eb", background: "#fff", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <img src="/phylo-scope/favicon.svg" alt="" style={{ width: 22, height: 22, flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em", marginRight: 4 }}>phyloScope <span style={{ fontWeight: 400, color: "#9ca3af" }}>v0.4</span></span>
        <label style={btn("secondary")}>
          Upload .nwk / .nex / .tre
          <input type="file" accept=".nwk,.txt,.tree,.tre,.nex,.nexus,.nxs" onChange={handleFile} style={{ display: "none" }} />
        </label>
        <button style={btn("ghost")} onClick={function() { setNewickInput(sampleNewick); loadTree(sampleNewick); }}>Demo Tree</button>
        <button style={btn("ghost")} onClick={openFeedback}>Feedback</button>
        <button style={btn("ghost")} onClick={function() { setCiteOpen(true); }}>How to Cite</button>
        {treeData && (
          <>
            <div style={divider} />
            <button style={btn(layout === "rectangular" ? "primary" : "ghost")} onClick={function() { zoomTransformRef.current = d3.zoomIdentity; setLayout("rectangular"); }}>Rectangular</button>
            <button style={btn(layout === "radial" ? "primary" : "ghost")} onClick={function() { zoomTransformRef.current = d3.zoomIdentity; setLayout("radial"); }}>Radial (Beta)</button>
            <div style={divider} />
            <button style={btn("ghost")} onClick={function() { doLadderize(true); }}>Ladderize ↑</button>
            <button style={btn("ghost")} onClick={function() { doLadderize(false); }}>Ladderize ↓</button>
            <div style={divider} />
            <button style={btn(mode === "reroot" ? "active" : "ghost")} onClick={function() { setMode(function(m) { return m === "reroot" ? "select" : "reroot"; }); }}>
              {mode === "reroot" ? "🎯 Click a node…" : "Reroot"}
            </button>
            <button style={btn("ghost")} onClick={undo} disabled={history.length === 0}>Undo</button>
            <button style={btn("ghost")} onClick={exportNewick}>Export .nwk</button>
            <button style={btn("ghost")} onClick={openSource}>See Source</button>
            {hasBranchLengths(treeData) && (
              <button style={btn("ghost")} onClick={function() { setLttOpen(true); }}>LTT Plot</button>
            )}
            <div style={divider} />
            <button style={btn(flipAxis ? "active" : "ghost")} onClick={function() { setFlipAxis(function(f) { return !f; }); }}>⇄ Time before present</button>
            <button style={btn(showLabels ? "active" : "ghost")} onClick={function() { setShowLabels(function(s) { return !s; }); }}>Labels {showLabels ? "on" : "off"}</button>
            <div style={divider} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>Text</span>
              <input type="range" min={8} max={24} value={fontSize} onChange={function(e) { setFontSize(+e.target.value); }}
                style={{ width: 70, accentColor: "#374151", cursor: "pointer" }} />
              <span style={{ fontSize: 11, color: "#374151", width: 24 }}>{fontSize}px</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>Weight</span>
              <input type="range" min={0.5} max={3} step={0.1} value={lineSize} onChange={function(e) { setLineSize(+e.target.value); }}
                style={{ width: 70, accentColor: "#374151", cursor: "pointer" }} />
            </div>
            {leafCount > 0 && <span style={{ fontSize: 11, color: "#9ca3af" }}>{leafCount.toLocaleString()} tips</span>}
          </>
        )}
      </div>

      {!treeData && (
        <div style={{ padding: 20, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <textarea value={newickInput} onChange={function(e) { setNewickInput(e.target.value); }}
            placeholder="Paste Newick or NEXUS string here… e.g. ((A,B),C);"
            style={{ flex: 1, height: 80, padding: 10, border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, fontFamily: "monospace", resize: "vertical" }} />
          <button style={btn("primary")} onClick={function() { loadTree(newickInput); }}>Load</button>
        </div>
      )}
      {error && <div style={{ color: "#dc2626", padding: "4px 16px", fontSize: 13 }}>{error}</div>}

      {treeData && (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", cursor: "crosshair" }} />
            {focusCladeId != null && (
              <button onClick={function() { setFocusCladeId(null); }} style={{
                position: "absolute", top: 10, left: 10, zIndex: 10,
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 10px", borderRadius: 6, border: "1px solid #d97706",
                background: "#fef9c3", color: "#78350f",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                boxShadow: "0 1px 4px rgba(0,0,0,0.15)"
              }}>
                ↩ Full tree
              </button>
            )}
          </div>

          <div style={{ width: 240, borderLeft: "1px solid #e5e7eb", background: "#fff", display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb" }}>
              {["clade", "search", "traits"].map(function(p) {
                return (
                  <button key={p} onClick={function() { setActivePanel(p); }} style={{
                    flex: 1, padding: "8px 0", fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer",
                    background: activePanel === p ? "#fff" : "#f9fafb",
                    color: activePanel === p ? "#111827" : "#6b7280",
                    borderBottom: activePanel === p ? "2px solid #111827" : "2px solid transparent",
                  }}>
                    {p === "clade" ? "Clade" : p === "search" ? "Search" : "Traits"}
                  </button>
                );
              })}
            </div>

            {activePanel === "clade" && (
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>

                {multiSelected.size > 0 && (
                  <div style={{ padding: 14, borderBottom: "1px solid #f3f4f6", background: "#faf5ff" }}>
                    <div style={Object.assign({}, sectionLabel, { color: "#7c3aed" })}>Paraphyletic Group ({multiSelected.size} nodes)</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                      {multiNodes.map(function(n) {
                        return (
                          <div key={n._id} style={{ fontSize: 11, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 8px", background: "#ede9fe", borderRadius: 4 }}>
                            <span style={{ fontFamily: "monospace", color: "#7c3aed", fontWeight: 600 }}>{n.name || "(internal)"}</span>
                            <button onClick={function() { setMultiSelected(function(prev) { const s = new Set(prev); s.delete(n._id); return s; }); }}
                              style={{ border: "none", background: "none", cursor: "pointer", color: "#a78bfa", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>×</button>
                          </div>
                        );
                      })}
                    </div>
                    {(function() {
                      const scene = sceneRef.current;
                      if (!scene || !scene.useBL || !treeData) return null;
                      const cb = computeConnectingBranches(treeData, multiSelected);
                      const pd = sumEdgeLengths(treeData, cb);
                      const mrcaId = findMRCA(treeData, multiSelected);
                      const rootPath = mrcaId != null ? stemLengthToNode(treeData, mrcaId) : 0;
                      const mrcaNode = mrcaId != null ? findNode(treeData, mrcaId) : null;
                      const mrcaHeight = mrcaNode ? nodeHeight(mrcaNode) : null;
                      return (
                        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8, lineHeight: 1.7, padding: "6px 8px", background: "#ede9fe", borderRadius: 4 }}>
                          <span style={{ fontWeight: 700, color: "#7c3aed" }}>Phylogenetic Diversity</span><br />
                          {pd.toFixed(2)} <span style={{ color: "#9ca3af" }}>(incl. root path: {(pd + rootPath).toFixed(2)})</span>
                          {mrcaHeight != null && mrcaHeight > 0 && (
                            <><br /><span style={{ fontWeight: 700, color: "#7c3aed" }}>MRCA height</span>{" "}{mrcaHeight.toFixed(5)}</>
                          )}
                        </div>
                      );
                    })()}
                    <button style={Object.assign({}, btn("ghost", true), { color: "#7c3aed" })} onClick={function() { setMultiSelected(new Set()); }}>Clear selection</button>
                    <button style={Object.assign({}, btn("ghost", true), { color: "#7c3aed", marginTop: 4 })} onClick={function() {
                      const mrcaId = findMRCA(treeData, multiSelected);
                      if (mrcaId != null) { setSelectedId(mrcaId); setMultiSelected(new Set()); }
                    }}>Select Monophyly</button>
                    <button style={Object.assign({}, btn("ghost", true), { color: "#7c3aed", marginTop: 4 })}
                      onClick={extractMultiTips}>
                      Extract selected tips
                    </button>
                    <button style={Object.assign({}, btn("primary", true), { marginTop: 6, background: "#dc2626", borderColor: "#dc2626", fontWeight: 700 })}
                      onClick={function() { setDeleteConfirm(true); }}>
                      Delete Tips
                    </button>
                  </div>
                )}

                <div style={{ padding: 14, borderBottom: "1px solid #f3f4f6" }}>
                  <div style={sectionLabel}>Clade Actions</div>
                  {selectedNode ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 12, padding: "6px 10px", background: "#eff6ff", borderRadius: 6, color: "#1d4ed8", fontWeight: 500 }}>
                        {selectedNode.name || "(internal node)"}
                      </div>
                      {(!selectedNode.children || !selectedNode.children.length) && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <input
                            value={renameValue}
                            onChange={function(e) { setRenameValue(e.target.value); }}
                            onKeyDown={function(e) { if (e.key === "Enter") doRename(renameValue); }}
                            placeholder="Rename tip…"
                            style={{ flex: 1, fontSize: 12, padding: "4px 8px", border: "1px solid #d1d5db", borderRadius: 6, outline: "none", fontFamily: "inherit" }}
                          />
                          <button style={btn("secondary")} onClick={function() { doRename(renameValue); }}>OK</button>
                        </div>
                      )}
                      <button style={btn("secondary", true)} onClick={toggleCollapse}>{selectedNode._collapsed ? "Expand clade" : "Collapse clade"}</button>
                      {(!selectedNode.children || !selectedNode.children.length) ? null : (
                        <button style={btn("secondary", true)} onClick={collapseOthers}>Collapse others</button>
                      )}
                      <button style={btn("secondary", true)} onClick={extractClade}>Extract clade</button>
                      <button style={Object.assign({}, btn("secondary", true), { color: "#dc2626", borderColor: "#fca5a5" })} onClick={deleteClade}>Delete clade</button>
                      <button style={btn("ghost", true)} onClick={function() { setSelectedId(null); setRenameValue(""); }}>Deselect</button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
                      Click a node or branch to select.<br />
                      <span style={{ color: "#93c5fd" }}>⇧ click</span> two nodes to select their clade.<br />
                      <span style={{ color: "#c4b5fd" }}>⌘/Ctrl+click</span> to build a paraphyletic group.
                    </div>
                  )}
                </div>

                <div style={{ padding: 14, borderBottom: "1px solid #f3f4f6" }}>
                  <div style={sectionLabel}>Node Labels</div>
                  {(function() {
                    const anyAvailable = (hasBranchLengths(treeData)) || treeHasInternalLabels || treeAnnotationKeys.length > 0;
                    if (!anyAvailable) return (
                      <div style={{ fontSize: 12, color: "#9ca3af" }}>No node labels available for this tree.</div>
                    );
                    const anyActive = showNodeHeights || showNodeLabels || activeNodeAnnotations.length > 0;
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {hasBranchLengths(treeData) && (
                          <div>
                            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "#374151" }}>
                              <input type="checkbox" checked={showNodeHeights} onChange={function(e) { setShowNodeHeights(e.target.checked); }} />
                              Node heights
                            </label>
                            {showNodeHeights && (
                              <div style={{ marginLeft: 20, marginTop: 4, display: "flex", gap: 12 }}>
                                <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "#6b7280" }}>
                                  <input type="radio" name="nodeHeightMode" value="from_root" checked={nodeHeightMode === "from_root"} onChange={function() { setNodeHeightMode("from_root"); }} />
                                  From root
                                </label>
                                <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "#6b7280" }}>
                                  <input type="radio" name="nodeHeightMode" value="before_present" checked={nodeHeightMode === "before_present"} onChange={function() { setNodeHeightMode("before_present"); }} />
                                  Before present
                                </label>
                              </div>
                            )}
                          </div>
                        )}
                        {treeHasInternalLabels && (
                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "#374151" }}>
                            <input type="checkbox" checked={showNodeLabels} onChange={function(e) { setShowNodeLabels(e.target.checked); }} />
                            Support values
                          </label>
                        )}
                        {treeAnnotationKeys.length > 0 && (
                          <div>
                            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 3 }}>Annotations</div>
                            {treeAnnotationKeys.map(function(key) {
                              const isActive = activeNodeAnnotations.includes(key);
                              return (
                                <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "#374151", marginBottom: 3 }}>
                                  <input type="checkbox" checked={isActive} onChange={function() {
                                    setActiveNodeAnnotations(function(prev) {
                                      return prev.includes(key) ? prev.filter(function(k) { return k !== key; }) : prev.concat([key]);
                                    });
                                  }} />
                                  {key}
                                </label>
                              );
                            })}
                          </div>
                        )}
                        {Object.keys(userAnnotations).length > 0 && (
                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "#374151" }}>
                            <input type="checkbox" checked={showUserAnnotations} onChange={function(e) { setShowUserAnnotations(e.target.checked); }} />
                            <span>Show notes <span style={{ fontSize: 10, background: "#fef9c3", border: "1px solid #d97706", color: "#92400e", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>{Object.keys(userAnnotations).length}</span></span>
                          </label>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div style={{ padding: "0 14px", borderBottom: "1px solid #f3f4f6" }}>
                  <button
                    onClick={function() { setNoteExpanded(function(x) { return !x; }); }}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    <span>
                      Node Note
                      {selectedId != null && userAnnotations[selectedId] && (
                        <span style={{ marginLeft: 6, display: "inline-block", width: 8, height: 8, borderRadius: 2, background: NOTE_COLORS[userAnnotations[selectedId].colorIdx || 0].border, verticalAlign: "middle" }} />
                      )}
                    </span>
                    <span style={{ fontSize: 9, color: "#9ca3af" }}>{noteExpanded ? "▼" : "▶"}</span>
                  </button>
                  {noteExpanded && (
                    <div style={{ paddingBottom: 10 }}>
                      {selectedId == null ? (
                        <div style={{ fontSize: 12, color: "#9ca3af", paddingBottom: 4 }}>Select a node to add a note.</div>
                      ) : (
                        <>
                          <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
                            {NOTE_COLORS.map(function(c, i) {
                              return (
                                <button key={i} onClick={function() { setNoteColorIdx(i); }}
                                  title={["Amber","Green","Blue","Pink","Purple"][i]}
                                  style={{ width: 22, height: 22, borderRadius: 5, background: c.fill, border: "2px solid " + (noteColorIdx === i ? c.border : "#d1d5db"), cursor: "pointer", padding: 0, flexShrink: 0 }} />
                              );
                            })}
                          </div>
                          <textarea
                            value={noteInput}
                            onChange={function(e) { setNoteInput(e.target.value); }}
                            onKeyDown={function(e) { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveNote(); } }}
                            placeholder="Add a note for this node…"
                            rows={2}
                            style={{ width: "100%", fontSize: 12, padding: "5px 8px", border: "1px solid " + NOTE_COLORS[noteColorIdx].border, borderRadius: 6, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", outline: "none", lineHeight: 1.5, background: NOTE_COLORS[noteColorIdx].fill }}
                          />
                          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                            <button style={Object.assign({}, btn("secondary"), { flex: 1 })} onClick={saveNote}>Save note</button>
                            {userAnnotations[selectedId] && (
                              <button style={Object.assign({}, btn("ghost"), { color: "#dc2626" })} onClick={deleteNote}>Remove</button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {cladeSummary && (
                  <div style={{ padding: 14, borderBottom: "1px solid #f3f4f6" }}>
                    <div style={sectionLabel}>Branch Info</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {cladeSummary.branchLength != null && <StatRow label="Branch length" value={cladeSummary.branchLength.toFixed(6)} color="#d97706" />}
                      {cladeSummary.tips.length === 1
                        ? <StatRow label="Tip name" value={cladeSummary.tips[0]} color="#2563eb" />
                        : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <StatRow label="Tips in clade" value={cladeSummary.tips.length} color="#2563eb" />
                            {cladeSummary.height > 0 && <StatRow label="Node height" value={cladeSummary.height.toFixed(5)} color="#2563eb" />}
                            {cladeSummary.sumBL > 0 && (
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                                <span style={{ fontSize: 11, color: "#2563eb" }}>Phylogenetic Diversity</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "#2563eb", fontFamily: "monospace", textAlign: "right" }}>
                                  {cladeSummary.sumBL.toFixed(2)}{" "}
                                  <span style={{ color: "#93c5fd", fontWeight: 400 }}>
                                    (incl. root path: {(cladeSummary.sumBL + stemLengthToNode(treeData, selectedId)).toFixed(2)})
                                  </span>
                                </span>
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: 11, color: "#2563eb", fontWeight: 600, marginBottom: 4 }}>TIPS</div>
                              <div style={{ maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                                {cladeSummary.tips.slice(0, 200).map(function(t, i) {
                                  const ni = sceneRef.current ? sceneRef.current.nodes.find(function(n) { return n.name === t && n.isLeaf; }) : null;
                                  return (
                                    <div key={i}
                                      onClick={function() { if (ni) { setCladeFocusId(ni.id); setSelectedId(ni.id); snapToId(ni.id); } }}
                                      style={{ fontSize: 11, color: cladeFocusId === (ni ? ni.id : null) ? "#dc2626" : "#374151", padding: "2px 6px", background: cladeFocusId === (ni ? ni.id : null) ? "#fef2f2" : "#f9fafb", borderRadius: 4, fontFamily: "monospace", wordBreak: "break-all", cursor: ni ? "pointer" : "default", fontWeight: cladeFocusId === (ni ? ni.id : null) ? 700 : 400 }}
                                      onMouseEnter={function(e) { if (ni) e.currentTarget.style.background = "#ffe4e6"; }}
                                      onMouseLeave={function(e) { e.currentTarget.style.background = cladeFocusId === (ni ? ni.id : null) ? "#fef2f2" : "#f9fafb"; }}
                                    >{t}</div>
                                  );
                                })}
                                {cladeSummary.tips.length > 200 && (
                                  <div style={{ fontSize: 11, color: "#9ca3af", padding: "2px 6px" }}>and {cladeSummary.tips.length - 200} more</div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                )}

                <div style={{ padding: 14, marginTop: "auto" }}>
                  <div style={{ fontSize: 11, color: "#d1d5db", lineHeight: 1.8 }}>
                    Scroll to zoom · Drag to pan<br />
                    <span style={{ color: "#e5e7eb" }}>⇧ scroll</span> to pan vertically · <span style={{ color: "#e5e7eb" }}>⌘⇧ scroll</span> to pan horizontally<br />
                    Hit Space to re-centre<br />
                    <span style={{ color: "#93c5fd" }}>⇧ click</span> two nodes to select their clade<br />
                    <span style={{ color: "#c4b5fd" }}>⌘/Ctrl+click</span> to build paraphyletic group
                  </div>
                </div>
              </div>
            )}

            {activePanel === "search" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6" }}>
                  <input type="text" value={searchQuery} onChange={function(e) { setSearchQuery(e.target.value); }}
                    placeholder="Search tip labels…"
                    style={{ width: "100%", padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12, fontFamily: "system-ui, sans-serif", boxSizing: "border-box", outline: "none" }}
                    autoFocus />
                  {searchQuery && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "#6b7280" }}>
                      {searchMatches.length === 0 ? "No matches" : searchMatches.length + " match" + (searchMatches.length !== 1 ? "es" : "")}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, overflowY: "auto" }}>
                  {searchMatches.map(function(m) {
                    const isInMulti = multiSelected.has(m.id);
                    const isSingleSel = selectedId === m.id;
                    const bgColor = isInMulti ? "#ede9fe" : isSingleSel ? "#eff6ff" : "#fff";
                    const textColor = isInMulti ? "#7c3aed" : isSingleSel ? "#1d4ed8" : "#374151";
                    const dotColor = isInMulti ? "#7c3aed" : isSingleSel ? "#2563eb" : "#ef4444";
                    const hoverBg = isInMulti ? "#ddd6fe" : isSingleSel ? "#dbeafe" : "#eff6ff";
                    return (
                      <div key={m.id}
                        onClick={function(e) {
                          if (e.metaKey || e.ctrlKey) {
                            setMultiSelected(function(prev) {
                              const next = new Set(prev);
                              if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                              return next;
                            });
                            setSelectedId(null);
                          } else if (e.shiftKey && (selectedIdRef.current != null || multiSelectedRef.current.size > 0)) {
                            const baseIds = new Set(multiSelectedRef.current);
                            if (selectedIdRef.current != null) baseIds.add(selectedIdRef.current);
                            baseIds.add(m.id);
                            const mrcaId = findMRCA(treeDataRef.current, baseIds);
                            if (mrcaId != null) {
                              setSelectedId(mrcaId);
                              setMultiSelected(new Set());
                            }
                          } else {
                            setSelectedId(m.id);
                            setMultiSelected(new Set());
                            setSearchFocusId(m.id);
                            snapToId(m.id);
                          }
                        }}
                        style={{ padding: "7px 12px", fontSize: 12, fontFamily: "monospace", cursor: "pointer", color: textColor, borderBottom: "1px solid #f9fafb", background: bgColor, wordBreak: "break-all", fontWeight: (isInMulti || isSingleSel) ? 700 : 400 }}
                        onMouseEnter={function(e) { e.currentTarget.style.background = hoverBg; }}
                        onMouseLeave={function(e) { e.currentTarget.style.background = bgColor; }}>
                        <span style={{ color: dotColor, fontWeight: 700 }}>● </span>
                        {highlightMatch(m.name, searchQuery)}
                      </div>
                    );
                  })}
                  {!searchQuery && (
                    <div style={{ padding: 14, fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
                      Type to search tip labels. Click a result to zoom to it.
                      <br />
                      <span style={{ color: "#c4b5fd" }}>{"⌘/Ctrl+click"}</span>{" to add to paraphyletic group."}
                      <br />
                      <span style={{ color: "#93c5fd" }}>{"⇧ click"}</span>{" to select monophyletic clade."}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activePanel === "traits" && (
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6" }}>
                  <label style={Object.assign({}, btn("secondary"), { display: "block", textAlign: "center", cursor: "pointer" })}>
                    Upload trait CSV
                    <input type="file" accept=".csv,.txt,.tsv" onChange={handleTraitFile} style={{ display: "none" }} />
                  </label>
                  {treeData && !traitData && (
                    <button style={Object.assign({}, btn("secondary"), { display: "block", width: "100%", textAlign: "center", marginTop: 6, boxSizing: "border-box" })} onClick={createTraitData}>
                      Create trait CSV
                    </button>
                  )}
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 6, lineHeight: 1.5 }}>
                    First column: tip names. Remaining columns: traits. Numeric columns are treated as continuous, text as discrete. Empty cells / NA are shown in grey.
                  </div>
                </div>

                {!traitData && (
                  <div style={{ padding: 14, fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
                    Upload a CSV or create a blank table to visualise trait data alongside the tree.
                  </div>
                )}

                {traitData && (
                  <>
                    <div style={{ padding: "5px 12px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "#6b7280" }}>{traitMatchCount.matched} / {traitMatchCount.total} tips matched</span>
                      <button style={Object.assign({}, btn("secondary"), { fontSize: 11, padding: "3px 9px" })}
                        onClick={function() { setDataTableOpen(function(x) { return !x; }); }}>
                        {dataTableOpen ? "Hide data" : "View data"}
                      </button>
                    </div>
                    {traitNames.length === 0 && (
                      <div style={{ padding: 14, fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
                        {traitMatchCount.total} tips loaded. Use "Add column" in the data editor to create trait columns.
                      </div>
                    )}
                    <div style={{ flex: 1, overflowY: "auto" }}>
                      {traitNames.map(function(name) {
                        const meta = traitMeta[name]; if (!meta) return null;
                        const isActive = activeTraits.includes(name);
                        return (
                          <div key={name} style={{ padding: "10px 12px", borderBottom: "1px solid #f9fafb", opacity: isActive ? 1 : 0.5 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                              <input type="checkbox" checked={isActive} onChange={function() {
                                setActiveTraits(function(prev) { return prev.includes(name) ? prev.filter(function(t) { return t !== name; }) : prev.concat([name]); });
                              }} style={{ cursor: "pointer", accentColor: "#374151", flexShrink: 0 }} />
                              <span style={{ fontSize: 11, fontWeight: 600, color: "#111827", fontFamily: "monospace", flex: 1, wordBreak: "break-all" }}>{name}</span>
                              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10, flexShrink: 0,
                                background: meta.type === "continuous" ? "#dbeafe" : "#f0fdf4",
                                color: meta.type === "continuous" ? "#1d4ed8" : "#15803d" }}>
                                {meta.type === "continuous" ? "cont." : "disc."}
                              </span>
                            </div>
                            {meta.type === "continuous" && (
                              <div style={{ marginLeft: 22 }}>
                                <div style={{ height: 7, borderRadius: 3, marginBottom: 2,
                                  background: paletteCSSGradient((CONTINUOUS_PALETTES.find(function(p) { return p.key === (meta.palette || "viridis"); }) || CONTINUOUS_PALETTES[0]).fn) }} />
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9ca3af", marginBottom: 5 }}>
                                  <span>{Number(meta.min.toPrecision(4))}</span>
                                  <span>{Number(meta.max.toPrecision(4))}</span>
                                </div>
                                <div style={{ display: "flex", gap: 3 }}>
                                  {CONTINUOUS_PALETTES.map(function(pal) {
                                    const isSelected = (meta.palette || "viridis") === pal.key;
                                    return (
                                      <button key={pal.key} title={pal.label}
                                        onClick={function() { updateTraitPalette(name, pal.key); }}
                                        style={{ flex: 1, height: 10, borderRadius: 2, border: "2px solid " + (isSelected ? "#111827" : "transparent"), background: paletteCSSGradient(pal.fn), cursor: "pointer", padding: 0 }} />
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {meta.type === "discrete" && (
                              <div style={{ marginLeft: 22, display: "flex", flexDirection: "column", gap: 2 }}>
                                {meta.categories.slice(0, 8).map(function(cat) {
                                  return (
                                    <div key={cat} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                      <div style={{ width: 10, height: 10, borderRadius: 2, background: meta.colorMap[cat], flexShrink: 0 }} />
                                      <span style={{ fontSize: 11, fontFamily: "monospace", color: "#374151", wordBreak: "break-all" }}>{cat}</span>
                                    </div>
                                  );
                                })}
                                {meta.categories.length > 8 && (
                                  <span style={{ fontSize: 10, color: "#9ca3af" }}>+{meta.categories.length - 8} more categories</span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ padding: 10, borderTop: "1px solid #f3f4f6" }}>
                      <button style={Object.assign({}, btn("ghost"), { width: "100%", fontSize: 11, color: "#dc2626" })} onClick={clearTraits}>Clear trait data</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {dataTableOpen && traitData && (
            <div style={{ width: 420, borderLeft: "1px solid #e5e7eb", background: "#fff", display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 8, background: "#f9fafb", flexShrink: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 13, flex: 1, color: "#111827" }}>Trait Data</span>
                <div style={{ display: "flex", gap: 2, background: "#f3f4f6", borderRadius: 5, padding: 2 }}>
                  <button title="Tree order" onClick={function() { setTraitRowSort("tree"); }}
                    style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, border: "none", cursor: "pointer", fontWeight: 500, background: traitRowSort === "tree" ? "#fff" : "transparent", color: traitRowSort === "tree" ? "#111827" : "#9ca3af", boxShadow: traitRowSort === "tree" ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}>
                    Tree
                  </button>
                  <button title="Alphabetical order" onClick={function() { setTraitRowSort("alpha"); }}
                    style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, border: "none", cursor: "pointer", fontWeight: 500, background: traitRowSort === "alpha" ? "#fff" : "transparent", color: traitRowSort === "alpha" ? "#111827" : "#9ca3af", boxShadow: traitRowSort === "alpha" ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}>
                    A→Z
                  </button>
                </div>
                <button style={Object.assign({}, btn("secondary"), { fontSize: 11, padding: "3px 9px" })} onClick={exportTraitCSV}>Export CSV</button>
                <button onClick={function() { setDataTableOpen(false); }} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#9ca3af", lineHeight: 1, padding: "0 2px" }}>×</button>
              </div>
              <div style={{ padding: "5px 10px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: 6, flexShrink: 0 }}>
                <input
                  value={newColName}
                  onChange={function(e) { setNewColName(e.target.value); }}
                  onKeyDown={function(e) { if (e.key === "Enter") addTraitColumn(); }}
                  placeholder="New column name…"
                  style={{ flex: 1, fontSize: 11, padding: "3px 8px", border: "1px solid #d1d5db", borderRadius: 5, outline: "none", fontFamily: "inherit" }}
                />
                <button style={Object.assign({}, btn("secondary"), { fontSize: 11, padding: "3px 9px" })} onClick={addTraitColumn}>Add</button>
              </div>
              <div ref={tableContainerRef} style={{ flex: 1, overflow: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%", tableLayout: "auto" }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", top: 0, padding: "5px 10px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e5e7eb", background: "#f9fafb", whiteSpace: "nowrap", zIndex: 1 }}>tip_labels</th>
                      {traitNames.map(function(col) {
                        const isHidden = hiddenTraitCols.has(col);
                        if (isHidden) {
                          return (
                            <th key={col} style={{ position: "sticky", top: 0, width: 22, minWidth: 22, maxWidth: 22, padding: "0 2px", borderBottom: "2px solid #e5e7eb", background: "#f9fafb", zIndex: 1 }}>
                              <button title={"Show " + col} onClick={function() { setHiddenTraitCols(function(prev) { const s = new Set(prev); s.delete(col); return s; }); }}
                                style={{ border: "none", background: "none", cursor: "pointer", color: "#9ca3af", fontSize: 10, padding: 0, lineHeight: 1, width: "100%", textAlign: "center" }}>▸</button>
                            </th>
                          );
                        }
                        return (
                          <th key={col} style={{ position: "sticky", top: 0, padding: "5px 6px 5px 10px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "2px solid #e5e7eb", background: "#f9fafb", whiteSpace: "nowrap", zIndex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ flex: 1 }}>{col}</span>
                              {traitMeta[col] && (
                                <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 8, background: traitMeta[col].type === "continuous" ? "#dbeafe" : "#f0fdf4", color: traitMeta[col].type === "continuous" ? "#1d4ed8" : "#15803d", flexShrink: 0 }}>
                                  {traitMeta[col].type === "continuous" ? "C" : "D"}
                                </span>
                              )}
                              <button title={"Hide " + col} onClick={function() { setHiddenTraitCols(function(prev) { const s = new Set(prev); s.add(col); return s; }); }}
                                style={{ border: "none", background: "none", cursor: "pointer", color: "#d1d5db", fontSize: 11, padding: 0, lineHeight: 1, flexShrink: 0 }}>▾</button>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody key={traitVersion}>
                    {(function() {
                      const treeLeaves = treeData ? getLeafNames(treeData) : [];
                      const treeLeafSet = new Set(treeLeaves);
                      const orderedTips = traitRowSort === "alpha"
                        ? Object.keys(traitData).slice().sort(function(a, b) { return a.localeCompare(b); })
                        : treeLeaves.filter(function(n) { return traitData[n]; })
                            .concat(Object.keys(traitData).filter(function(n) { return !treeLeafSet.has(n); }));
                      const selTipName = selectedNode && (!selectedNode.children || !selectedNode.children.length) ? selectedNode.name : null;
                      return orderedTips.map(function(tip) {
                        const isSelected = tip === selTipName;
                        return (
                          <tr key={tip}
                            ref={function(el) { rowRefsMap.current[tip] = el; }}
                            onFocus={function() {
                              const ni = nodesRef.current.find(function(n) { return n.isLeaf && n.name === tip; });
                              if (ni) { setSelectedId(ni.id); setMultiSelected(new Set()); }
                            }}
                            style={{ background: isSelected ? "#eff6ff" : "transparent", borderBottom: "1px solid #f3f4f6" }}>
                            <td style={{ padding: "3px 10px", fontWeight: isSelected ? 700 : 400, color: isSelected ? "#1d4ed8" : "#374151", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 11 }}>{tip}</td>
                            {traitNames.map(function(col) {
                              if (hiddenTraitCols.has(col)) {
                                return <td key={col} style={{ width: 22, minWidth: 22, maxWidth: 22, padding: 0, background: "#f9fafb" }} />;
                              }
                              const val = traitData[tip] ? traitData[tip][col] : null;
                              return (
                                <td key={col} style={{ padding: "2px 6px" }}>
                                  <input
                                    defaultValue={val === null || val === undefined ? "" : String(val)}
                                    onBlur={function(e) { handleCellEdit(tip, col, e.target.value); }}
                                    onKeyDown={function(e) { if (e.key === "Enter") e.target.blur(); }}
                                    style={{ width: 88, fontSize: 11, padding: "2px 6px", border: "1px solid #e5e7eb", borderRadius: 4, fontFamily: "monospace", outline: "none", background: val === null || val === undefined ? "#f9fafb" : "#fff", color: "#111827", boxSizing: "border-box" }}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!treeData && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 40 }}>🌿</div>
          <div style={{ fontSize: 14 }}>Upload a .nwk / .nex / .tre file or paste a Newick or NEXUS string to get started</div>
        </div>
      )}

      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 28, maxWidth: 360, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "#111827" }}>Delete Tips?</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 20, lineHeight: 1.6 }}>
              Are you sure you want to permanently delete{" "}
              <span style={{ fontWeight: 700, color: "#dc2626" }}>{tipsToDeleteCount} tip{tipsToDeleteCount !== 1 ? "s" : ""}</span>{" "}
              from the tree? This can be undone with Undo.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={btn("secondary")} onClick={function() { setDeleteConfirm(false); }}>Cancel</button>
              <button style={Object.assign({}, btn("primary"), { background: "#dc2626", borderColor: "#dc2626" })} onClick={deleteMultiTips}>
                Delete {tipsToDeleteCount} tip{tipsToDeleteCount !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {feedbackOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={function(e) { if (e.target === e.currentTarget) closeFeedback(); }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 28, maxWidth: 420, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>Share feedback</div>
              <button onClick={closeFeedback} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#9ca3af", lineHeight: 1, padding: "0 2px" }}>×</button>
            </div>

            {feedbackStatus === "success" ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>🌿</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#111827", marginBottom: 6 }}>Thanks for the feedback!</div>
                <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>We'll take a look and be in touch if needed.</div>
                <button style={btn("secondary")} onClick={closeFeedback}>Close</button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Email *</label>
                    <input type="email" value={feedbackEmail} onChange={function(e) { setFeedbackEmail(e.target.value); }}
                      placeholder="you@example.com"
                      style={{ width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, fontFamily: "system-ui, sans-serif", boxSizing: "border-box", outline: "none" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Type</label>
                    <select value={feedbackType} onChange={function(e) { setFeedbackType(e.target.value); }}
                      style={{ width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, fontFamily: "system-ui, sans-serif", background: "#fff", outline: "none", cursor: "pointer" }}>
                      <option value="bug">Bug report</option>
                      <option value="feature">Feature request</option>
                      <option value="other">General comment</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Message *</label>
                    <textarea value={feedbackMessage} onChange={function(e) { setFeedbackMessage(e.target.value); }}
                      placeholder="Describe the bug, feature, or comment…"
                      rows={5}
                      style={{ width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, fontFamily: "system-ui, sans-serif", resize: "vertical", boxSizing: "border-box", outline: "none" }} />
                  </div>
                  {feedbackStatus === "error" && (
                    <div style={{ fontSize: 12, color: "#dc2626" }}>Something went wrong — please try again.</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
                  <button style={btn("secondary")} onClick={closeFeedback}>Cancel</button>
                  <button style={btn("primary")}
                    disabled={feedbackStatus === "sending" || !feedbackEmail.trim() || !feedbackMessage.trim()}
                    onClick={submitFeedback}>
                    {feedbackStatus === "sending" ? "Sending…" : "Send feedback"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {lttOpen && treeData && (function() {
        var hasBL = hasBranchLengths(treeData);
        var W = 936, H = 504;
        var mg = { top: 28, right: 48, bottom: 76, left: 80 };
        var iW = W - mg.left - mg.right, iH = H - mg.top - mg.bottom;
        var pathD = "", xTicks = [], yTicks = [];
        if (hasBL) {
          var pts = computeLTT(treeData);
          var maxT = Math.max.apply(null, pts.map(function(p) { return p.t; }));
          var maxN = Math.max.apply(null, pts.map(function(p) { return p.n; }));
          var xSc = d3.scaleLinear().domain([0, maxT]).range([0, iW]);
          var ySc = d3.scaleLog().domain([1, Math.max(maxN, 2)]).range([iH, 0]).clamp(true);
          pathD = pts.map(function(p, i) {
            return (i === 0 ? "M" : "L") + xSc(p.t).toFixed(1) + "," + ySc(Math.max(1, p.n)).toFixed(1);
          }).join(" ");
          xTicks = xSc.ticks(6);
          var maxLog = Math.ceil(Math.log10(Math.max(maxN, 2)));
          yTicks = [];
          for (var p = 0; p <= maxLog; p++) { var tv = Math.pow(10, p); if (tv <= maxN * 1.05) yTicks.push(tv); }
          if (yTicks.length < 2) yTicks = ySc.ticks(4).filter(function(v) { return v >= 1; });
        }
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
            onClick={function(e) { if (e.target === e.currentTarget) setLttOpen(false); }}>
            <div style={{ background: "#fff", borderRadius: 10, padding: 24, maxWidth: 1030, width: "95%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>Lineages Through Time</div>
                <button onClick={function() { setLttOpen(false); }} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#9ca3af", lineHeight: 1, padding: "0 2px" }}>×</button>
              </div>
              {!hasBL ? (
                <div style={{ fontSize: 13, color: "#6b7280", padding: "20px 0" }}>This tree has no branch lengths — LTT requires a time-scaled tree.</div>
              ) : (
                <svg width={W} height={H} style={{ display: "block", maxWidth: "100%", overflow: "visible" }}>
                  <g transform={"translate(" + mg.left + "," + mg.top + ")"}>
                    {yTicks.map(function(v) {
                      var y = ySc(v).toFixed(1);
                      return <line key={v} x1={0} y1={y} x2={iW} y2={y} stroke="#f3f4f6" strokeWidth={1} />;
                    })}
                    {xTicks.map(function(v) {
                      var x = xSc(v).toFixed(1);
                      return <line key={v} x1={x} y1={0} x2={x} y2={iH} stroke="#f3f4f6" strokeWidth={1} />;
                    })}
                    <path d={pathD} fill="none" stroke="#1a5c35" strokeWidth={2.5} strokeLinejoin="round" />
                    <line x1={0} y1={iH} x2={iW} y2={iH} stroke="#9ca3af" strokeWidth={1} />
                    {xTicks.map(function(v) {
                      var x = xSc(v);
                      var label = v === 0 ? "0" : (Math.abs(v) >= 0.01 && Math.abs(v) < 10000 ? +v.toPrecision(4) : v.toExponential(2));
                      return (
                        <g key={v} transform={"translate(" + x.toFixed(1) + "," + iH + ")"}>
                          <line y2={5} stroke="#9ca3af" strokeWidth={1} />
                          <text y={18} textAnchor="middle" fontSize={10} fill="#6b7280">{label}</text>
                        </g>
                      );
                    })}
                    <text x={iW / 2} y={iH + 44} textAnchor="middle" fontSize={11} fill="#374151">Time from root</text>
                    <line x1={0} y1={0} x2={0} y2={iH} stroke="#9ca3af" strokeWidth={1} />
                    {yTicks.map(function(v) {
                      return (
                        <g key={v} transform={"translate(0," + ySc(v).toFixed(1) + ")"}>
                          <line x2={-5} stroke="#9ca3af" strokeWidth={1} />
                          <text x={-9} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#6b7280">{v}</text>
                        </g>
                      );
                    })}
                    <text transform={"translate(-62," + (iH / 2) + ") rotate(-90)"} textAnchor="middle" fontSize={11} fill="#374151">Lineages</text>
                  </g>
                </svg>
              )}
            </div>
          </div>
        );
      })()}

      {sourceOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={function(e) { if (e.target === e.currentTarget) closeSource(); }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 28, maxWidth: 560, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>Newick source</div>
              <button onClick={closeSource} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#9ca3af", lineHeight: 1, padding: "0 2px" }}>×</button>
            </div>
            <textarea value={sourceText} onChange={function(e) { setSourceText(e.target.value); }}
              rows={10}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box", outline: "none", lineHeight: 1.6 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
              <button style={btn("secondary")} onClick={function() { navigator.clipboard.writeText(sourceText); }}>Copy</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={btn("secondary")} onClick={closeSource}>Cancel</button>
                <button style={btn("primary")} onClick={confirmSource}>Confirm</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {citeOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={function(e) { if (e.target === e.currentTarget) setCiteOpen(false); }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 28, maxWidth: 500, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>How to Cite</div>
              <button onClick={function() { setCiteOpen(false); }} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#9ca3af", lineHeight: 1, padding: "0 2px" }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6 }}>Please cite phyloScope as:</div>
            {[
              { label: "APA", text: "Yaxley, K. J. (2026). phyloScope (Version 0.4) [Software]. https://keaghanjames.github.io/phylo-scope/" },
              { label: "BibTeX", text: "@software{yaxley2026phyloscope,\n  author  = {Yaxley, Keaghan J.},\n  title   = {phyloScope},\n  version = {0.4},\n  year    = {2026},\n  url     = {https://keaghanjames.github.io/phylo-scope/}\n}" },
            ].map(function(entry) {
              return (
                <div key={entry.label}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{entry.label}</div>
                  <div style={{ position: "relative" }}>
                    <pre style={{ margin: 0, padding: "10px 12px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 12, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#111827", lineHeight: 1.6 }}>{entry.text}</pre>
                    <button onClick={function() { navigator.clipboard.writeText(entry.text); }}
                      style={{ position: "absolute", top: 6, right: 6, fontSize: 11, padding: "2px 8px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer", color: "#6b7280" }}>
                      Copy
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {whatsNewOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
          onClick={function(e) { if (e.target === e.currentTarget) { localStorage.setItem("phylo_seen_whats_new", "v0.4"); setWhatsNewOpen(false); } }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 28, maxWidth: 480, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>
                {"What's new in "}
                <span style={{ color: "#1a5c35" }}>v0.4</span>
              </div>
              <button onClick={function() { localStorage.setItem("phylo_seen_whats_new", "v0.4"); setWhatsNewOpen(false); }}
                style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#9ca3af", lineHeight: 1, padding: "0 2px" }}>×</button>
            </div>
            <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { bold: "Trait data editor", text: " — persistent side panel showing the trait CSV as a live editable table; edits update the tree visualisation in real time" },
                { bold: "Create trait CSV", text: " — start a blank trait table pre-populated with all tip labels directly from the Traits tab, no file needed" },
                { bold: "Auto-scroll & highlight", text: " — clicking a tip on the tree scrolls to its row in the editor; focusing a row highlights the tip on the tree" },
                { bold: "Add columns", text: " — add new trait columns from inside the editor; they appear on the tree immediately" },
                { bold: "Hide columns", text: " — collapse any trait column with the ▾ arrow to reduce clutter, expand with ▸" },
                { bold: "Row sort", text: " — switch between tree order and A→Z alphabetical order in the editor header" },
                { bold: "Export CSV", text: " — export the current trait table (including any edits or new columns) as a CSV file" },
              ].map(function(item, i) {
                return (
                  <li key={i} style={{ fontSize: 13, color: "#374151", lineHeight: 1.55 }}>
                    <span style={{ fontWeight: 600 }}>{item.bold}</span>{item.text}
                  </li>
                );
              })}
            </ul>
            <button style={Object.assign({}, btn("primary"), { alignSelf: "flex-end" })}
              onClick={function() { localStorage.setItem("phylo_seen_whats_new", "v0.4"); setWhatsNewOpen(false); }}>
              Got it
            </button>
          </div>
        </div>
      )}

      {exportDialogOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={function(e) { if (e.target === e.currentTarget) setExportDialogOpen(false); }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 28, maxWidth: 360, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: "#111827" }}>Export Newick</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 22, lineHeight: 1.6 }}>
              Include node notes as <span style={{ fontFamily: "monospace", background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>[&amp;note=…]</span> annotations in the exported file?
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={btn("secondary")} onClick={function() { setExportDialogOpen(false); }}>Cancel</button>
              <button style={btn("secondary")} onClick={function() { doExport(false); }}>Skip notes</button>
              <button style={btn("primary")} onClick={function() { doExport(true); }}>Include notes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function highlightMatch(name, query) {
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return name;
  return (
    <span>
      {name.slice(0, idx)}
      <span style={{ background: "#fef08a", borderRadius: 2 }}>{name.slice(idx, idx + query.length)}</span>
      {name.slice(idx + query.length)}
    </span>
  );
}

function StatRow(props) {
  const c = props.color || "#6b7280";
  const vc = props.color || "#111827";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 11, color: c }}>{props.label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: vc, fontFamily: "monospace" }}>{props.value}</span>
    </div>
  );
}

const divider = { width: 1, height: 20, background: "#e5e7eb", flexShrink: 0 };
const sectionLabel = { fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 };

function btn(variant, full) {
  const base = {
    padding: "5px 11px", borderRadius: 6, fontSize: 12, fontWeight: 500,
    cursor: "pointer", border: "1px solid transparent", transition: "all 0.1s",
    whiteSpace: "nowrap", width: full ? "100%" : undefined,
    textAlign: full ? "center" : undefined, display: full ? "block" : undefined,
  };
  if (variant === "primary") return Object.assign({}, base, { background: "#111827", color: "#fff", borderColor: "#111827" });
  if (variant === "secondary") return Object.assign({}, base, { background: "#fff", color: "#374151", borderColor: "#d1d5db" });
  if (variant === "active") return Object.assign({}, base, { background: "#eff6ff", color: "#2563eb", borderColor: "#93c5fd" });
  return Object.assign({}, base, { background: "transparent", color: "#6b7280" });
}
