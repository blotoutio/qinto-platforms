// Public entry for the context route handler. Physical for the same reason as ./autocapture —
// see the note there. Re-exported into the merchant's app/ tree, where Next can discover it.
export { GET } from "./app/api/qinto/context/route"
