// The boundary between tib-tools and the game repo. Everything that reaches into
// the game does so through here, so the coupling stays in one place.
export { locateGame } from "./locate.ts";
export {
  loadCatalog,
  loadShared,
  loadWire,
  loadBalance,
  ensureContentBuilt,
  type Catalog,
  type Shared,
  type Wire,
  type Balance
} from "./adapter.ts";
