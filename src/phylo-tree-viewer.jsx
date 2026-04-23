import { useState, useEffect, useRef } from "react";
import * as d3 from "d3";

function parseNewick(s) {
  s = s.trim().replace(/;$/, "");
  let i = 0;
  function parseNode() {
    let node = { name: "", length: null, children: [] };
    if (s[i] === "(") {
      i++; node.children.push(parseNode());
      while (s[i] === ",") { i++; node.children.push(parseNode()); }
      i++;
    }
    let label = "";
    while (i < s.length && !":,()".includes(s[i])) label += s[i++];
    node.name = label.trim();
    if (s[i] === ":") {
      i++; let len = "";
      while (i < s.length && !",()".includes(s[i])) len += s[i++];
      node.length = parseFloat(len);
    }
    return node;
  }
  try { return parseNode(); } catch(e) { return null; }
}

function toNewick(n) {
  if (!n.children || !n.children.length) return n.name + (n.length != null ? ":" + n.length : "");
  return "(" + n.children.map(toNewick).join(",") + ")" + (n.name || "") + (n.length != null ? ":" + n.length : "");
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
      meta[col] = { type: "continuous", min, max,
        colorFn: function(v) { if (v === null) return null; const t = max === min ? 0.5 : (Number(v) - min) / (max - min); return d3.interpolateViridis(t); }
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
      if (treeData) {
        const leafNames = getLeafNames(treeData);
        setTraitMatchCount({ matched: leafNames.filter(function(n) { return rows[n] !== undefined; }).length, total: leafNames.length });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const clearTraits = function() { setTraitData(null); setTraitMeta({}); setTraitNames([]); setActiveTraits([]); setTraitMatchCount({ matched: 0, total: 0 }); };

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

  const sampleNewick = "((((Homo_sapiens:0.007,Pan_troglodytes:0.007):0.003,Gorilla_gorilla:0.01):0.008,Pongo_pygmaeus:0.018):0.012,Macaca_mulatta:0.03);";

  useEffect(function() { treeDataRef.current = treeData; }, [treeData]);
  useEffect(function() { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(function() { multiSelectedRef.current = multiSelected; }, [multiSelected]);

  const pushHistory = function(t) { setHistory(function(h) { return h.slice(-20).concat([t]); }); };

  const loadTree = function(str) {
    const parsed = parseNewick(str);
    if (!parsed) { setError("Invalid Newick format."); return; }
    setError("");
    assignIds(parsed);
    setLeafCount(countLeaves(parsed));
    setTreeData(parsed);
    setHistory([]);
    setSelectedId(null);
    setMultiSelected(new Set());
    setCladeSummary(null);
    setCladeFocusId(null);
    setSearchQuery("");
    zoomTransformRef.current = d3.zoomIdentity;
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
    const t = cloneTree(n); t.length = null; applyEdit(t);
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

  const exportNewick = function() {
    if (!treeData) return;
    const blob = new Blob([toNewick(treeData) + ";"], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "tree.nwk"; a.click();
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
    const k = transform.k, x = transform.x, y = transform.y;
    const mIds = matchIds || new Set();
    const ms = multiSel || new Set();
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    const sx = function(lx) { return lx * k + originX + x; };
    const sy = function(ly) { return ly * k + originY + y; };

    links.forEach(function(lk) {
      const isSel = lk.tgtId === sid;
      const inClade = selDescIds.has(lk.srcId) && selDescIds.has(lk.tgtId);
      const isMultiNode = ms.has(lk.tgtId);
      const isConn = connectingBranches.has(lk.tgtId);
      ctx.beginPath();
      ctx.strokeStyle = isSel ? "#f59e0b" : isMultiNode ? "#8b5cf6" : isConn ? "#a78bfa" : inClade ? "#2563eb" : "#d1d5db";
      ctx.lineWidth = isSel ? 2.5 : (isMultiNode || isConn) ? 2.5 : inClade ? 2 : 1;
      if (scLayout === "rectangular") {
        ctx.moveTo(sx(lk.sx), sy(lk.sy)); ctx.lineTo(sx(lk.sx), sy(lk.ty)); ctx.lineTo(sx(lk.tx), sy(lk.ty));
      } else {
        ctx.moveTo(sx(lk.sx), sy(lk.sy)); ctx.lineTo(sx(lk.tx), sy(lk.ty));
      }
      ctx.stroke();
    });

    const circleR = 3;
    const gap = circleR + 3;
    const autoShow = k > (scene.leafCount > 500 ? 500 / scene.leafCount : 0.3);
    const showLbls = scene.showLabels && autoShow;

    nodes.forEach(function(ni) {
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
        if (tm && tv !== null) traitNodeColor = tm.colorFn(tv);
      }

      ctx.beginPath();
      ctx.arc(screenX, screenY, (ni.selected || isMatch || isFocus || isMultiSel) ? 5 : circleR, 0, 2 * Math.PI);
      ctx.fillStyle = ni.selected ? "#2563eb" : isFocus ? "#dc2626" : isMatch ? "#ef4444"
        : isMultiSel ? "#7c3aed" : isConn ? "#a78bfa" : inClade ? "#93c5fd"
        : ni.collapsed ? "#f59e0b"
        : (traitNodeColor || (ni.isLeaf ? "#374151" : "#9ca3af"));
      ctx.fill();
      ctx.strokeStyle = (isFocus || isMultiSel) ? "#fff" : ni.selected ? "#1d4ed8" : "#fff";
      ctx.lineWidth = (isFocus || isMultiSel) ? 2 : 1.2;
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
          const color = tv !== null ? tm.colorFn(tv) : null;
          const x = sqStart + ti * (sqSz + sqPad);
          ctx.fillStyle = color || "#e5e7eb";
          ctx.fillRect(x, screenY - sqSz / 2, sqSz, sqSz);
          ctx.strokeStyle = "rgba(0,0,0,0.1)";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(x, screenY - sqSz / 2, sqSz, sqSz);
        });
      }

      if ((showLbls || isMatch || isFocus || isMultiSel) && (ni.name || ni.collapsed)) {
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
        return { id: d.data._id, localX: d.y, localY: d.x, isLeaf: !d.children, name: d.data.name, angle: null, collapsed: d.data._collapsed, inClade: selDescIds.has(d.data._id), selected: d.data._id === selectedId };
      });
    } else {
      const r = Math.min(W, H) / 2 - 80;
      originX = W / 2; originY = H / 2;
      root = d3.cluster().size([2 * Math.PI, r])(hier);
      links = root.links().map(function(d) {
        const sp = d3.pointRadial(d.source.x, d.source.y);
        const tp = d3.pointRadial(d.target.x, d.target.y);
        return { sx: sp[0], sy: sp[1], tx: tp[0], ty: tp[1], srcId: d.source.data._id, tgtId: d.target.data._id };
      });
      nodes = root.descendants().map(function(d) {
        const p = d3.pointRadial(d.x, d.y);
        return { id: d.data._id, localX: p[0], localY: p[1], isLeaf: !d.children, name: d.data.name, angle: d.x, collapsed: d.data._collapsed, inClade: selDescIds.has(d.data._id), selected: d.data._id === selectedId };
      });
    }

    sceneRef.current = { W, H, links, nodes, originX, originY, useBL, maxDepth, tw, margin, layout, selDescIds, selectedId, fontSize, flipAxis, showLabels, leafCount: nLeaves, searchFocusId, cladeFocusId, connectingBranches, traitData, traitMeta, activeTraits };
    nodesRef.current = nodes;
    nodes.forEach(function(n) { nodePositionMapRef.current[n.id] = { localX: n.localX, localY: n.localY }; });

    function hitTest(ex, ey, transform) {
      const k = transform.k, x = transform.x, y = transform.y;
      for (let i = 0; i < nodes.length; i++) {
        const ni = nodes[i];
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
        const circleR = 3, gap = circleR + 3;
        for (let i = 0; i < nodesRef.current.length; i++) {
          const ni = nodesRef.current[i];
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
      if (e.code === "Space" && treeData) {
        e.preventDefault();
        zoomTransformRef.current = d3.zoomIdentity;
        sel.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
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

  const selectedNode = selectedId != null && treeData ? findNode(treeData, selectedId) : null;
  const multiNodes = treeData ? Array.from(multiSelected).map(function(id) { return findNode(treeData, id); }).filter(Boolean) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif", background: "#f9fafb", color: "#111827" }}>

      <div style={{ padding: "10px 16px", borderBottom: "1px solid #e5e7eb", background: "#fff", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <img src="/phylo-viewer/favicon.svg" alt="" style={{ width: 22, height: 22, flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em", marginRight: 4 }}>Phylo Viewer <span style={{ fontWeight: 400, color: "#9ca3af" }}>v0.1</span></span>
        <label style={btn("secondary")}>
          Upload .nwk / .tre
          <input type="file" accept=".nwk,.txt,.tree,.tre" onChange={handleFile} style={{ display: "none" }} />
        </label>
        <button style={btn("ghost")} onClick={function() { setNewickInput(sampleNewick); loadTree(sampleNewick); }}>Demo Tree</button>
        <button style={btn("ghost")} onClick={openFeedback}>Feedback</button>
        {treeData && (
          <>
            <div style={divider} />
            <button style={btn(layout === "rectangular" ? "primary" : "ghost")} onClick={function() { zoomTransformRef.current = d3.zoomIdentity; setLayout("rectangular"); }}>Rectangular</button>
            <button style={btn(layout === "radial" ? "primary" : "ghost")} onClick={function() { zoomTransformRef.current = d3.zoomIdentity; setLayout("radial"); }}>Radial</button>
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
            {leafCount > 0 && <span style={{ fontSize: 11, color: "#9ca3af" }}>{leafCount.toLocaleString()} tips</span>}
          </>
        )}
      </div>

      {!treeData && (
        <div style={{ padding: 20, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <textarea value={newickInput} onChange={function(e) { setNewickInput(e.target.value); }}
            placeholder="Paste Newick string here… e.g. ((A,B),C);"
            style={{ flex: 1, height: 80, padding: 10, border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, fontFamily: "monospace", resize: "vertical" }} />
          <button style={btn("primary")} onClick={function() { loadTree(newickInput); }}>Load</button>
        </div>
      )}
      {error && <div style={{ color: "#dc2626", padding: "4px 16px", fontSize: 13 }}>{error}</div>}

      {treeData && (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", cursor: "crosshair" }} />
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
                      return (
                        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8, lineHeight: 1.7, padding: "6px 8px", background: "#ede9fe", borderRadius: 4 }}>
                          <span style={{ fontWeight: 700, color: "#7c3aed" }}>Phylogenetic Diversity</span><br />
                          {pd.toFixed(2)} <span style={{ color: "#9ca3af" }}>(incl. root path: {(pd + rootPath).toFixed(2)})</span>
                        </div>
                      );
                    })()}
                    <button style={Object.assign({}, btn("ghost", true), { color: "#7c3aed" })} onClick={function() { setMultiSelected(new Set()); }}>Clear selection</button>
                    <button style={Object.assign({}, btn("ghost", true), { color: "#7c3aed", marginTop: 4 })} onClick={function() {
                      const mrcaId = findMRCA(treeData, multiSelected);
                      if (mrcaId != null) { setSelectedId(mrcaId); setMultiSelected(new Set()); }
                    }}>Select Monophyly</button>
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
                      <button style={btn("secondary", true)} onClick={toggleCollapse}>{selectedNode._collapsed ? "Expand clade" : "Collapse clade"}</button>
                      <button style={btn("secondary", true)} onClick={extractClade}>Extract clade</button>
                      <button style={Object.assign({}, btn("secondary", true), { color: "#dc2626", borderColor: "#fca5a5" })} onClick={deleteClade}>Delete clade</button>
                      <button style={btn("ghost", true)} onClick={function() { setSelectedId(null); }}>Deselect</button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
                      Click a node or branch to select.<br />
                      <span style={{ color: "#93c5fd" }}>⇧ click</span> two nodes to select their clade.<br />
                      <span style={{ color: "#c4b5fd" }}>⌘/Ctrl+click</span> to build a paraphyletic group.
                    </div>
                  )}
                </div>

                {cladeSummary && (
                  <div style={{ padding: 14, borderBottom: "1px solid #f3f4f6" }}>
                    <div style={sectionLabel}>Branch Info</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {cladeSummary.branchLength != null && <StatRow label="Branch length" value={cladeSummary.branchLength.toFixed(6)} />}
                      {cladeSummary.tips.length === 1
                        ? <StatRow label="Tip name" value={cladeSummary.tips[0]} />
                        : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <StatRow label="Tips in clade" value={cladeSummary.tips.length} />
                            {cladeSummary.height > 0 && <StatRow label="Node height" value={cladeSummary.height.toFixed(5)} />}
                            {cladeSummary.sumBL > 0 && (
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                                <span style={{ fontSize: 11, color: "#6b7280" }}>Phylogenetic Diversity</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "#111827", fontFamily: "monospace", textAlign: "right" }}>
                                  {cladeSummary.sumBL.toFixed(2)}{" "}
                                  <span style={{ color: "#9ca3af", fontWeight: 400 }}>
                                    ({(cladeSummary.sumBL + stemLengthToNode(treeData, selectedId)).toFixed(2)})
                                  </span>
                                </span>
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, marginBottom: 4 }}>TIPS</div>
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
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 6, lineHeight: 1.5 }}>
                    First column: tip names. Remaining columns: traits. Numeric columns are treated as continuous, text as discrete. Empty cells / NA are shown in grey.
                  </div>
                </div>

                {traitNames.length === 0 && (
                  <div style={{ padding: 14, fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
                    Upload a CSV to visualise trait data alongside the tree.
                  </div>
                )}

                {traitNames.length > 0 && (
                  <>
                    <div style={{ padding: "6px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 11, color: "#6b7280" }}>
                      {traitMatchCount.matched} / {traitMatchCount.total} tips matched
                    </div>
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
                                  background: "linear-gradient(to right, " + d3.interpolateViridis(0) + ", " + d3.interpolateViridis(0.5) + ", " + d3.interpolateViridis(1) + ")" }} />
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9ca3af" }}>
                                  <span>{Number(meta.min.toPrecision(4))}</span>
                                  <span>{Number(meta.max.toPrecision(4))}</span>
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
        </div>
      )}

      {!treeData && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 40 }}>🌿</div>
          <div style={{ fontSize: 14 }}>Upload a .nwk / .tre file or paste a Newick string to get started</div>
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
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 11, color: "#6b7280" }}>{props.label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#111827", fontFamily: "monospace" }}>{props.value}</span>
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
