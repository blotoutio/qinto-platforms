// Public entry for the storefront component.
//
// A physical file, not just an `exports` alias: the Medusa starter's tsconfig sets
// `moduleResolution: "node"`, which ignores `exports` altogether. Bundlers resolve this
// through the export map, TypeScript resolves it by walking to this path, and both land here.
export { default } from "./modules/qinto/qinto-autocapture"
