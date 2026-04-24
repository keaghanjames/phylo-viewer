# phyloScope

An interactive phylogenetic tree viewer that runs entirely in the browser. Load a Newick-format tree file, explore it visually, and perform common tree editing operations — all without installing any software or sending your data to a server.

**Live app:** https://keaghanjames.github.io/phyloscope/

## Features

- Load trees from `.nwk` / `.tre` files or paste a Newick string directly
- Rectangular and radial layouts
- Branch-length scaling with time axis
- Zoom, pan, and snap-to-node navigation
- Clade selection, collapse, extract, and delete
- Paraphyletic group selection with Phylogenetic Diversity calculation
- Shift-click two nodes to select their MRCA clade
- Ladderize, reroot, undo, and export to Newick
- Tip label search

## Built with

- [React](https://react.dev/) + [Vite](https://vite.dev/)
- [D3](https://d3js.org/) (hierarchy, zoom, scales)
- Canvas rendering for performance on large trees

## Local development

```bash
npm install
npm run dev
```
