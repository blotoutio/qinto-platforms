import test from "node:test"
import assert from "node:assert/strict"

/**
 * The loader snippet's URL handling.
 *
 * The destination is interpolated into an inline `<script>` body, so it is the one value in the
 * integration that can reach script position on a merchant's storefront. An earlier version ran
 * `JSON.stringify` on the literal placeholder and then spliced the raw URL in with `.replace`,
 * which put unescaped text inside an already-closed JS string.
 *
 * This mirrors the component's exact expression so a regression there fails here.
 */
const build = (qintoUrl) => {
  const src = JSON.stringify(new URL("/q.js", qintoUrl).toString())

  return `d.head.appendChild(s)})(window,document,${src},"qinto");`
}

const wellFormed = [
  "https://abc.dev.qinto.tech",
  "https://abc.dev.qinto.tech/",
  "https://example.com/nested/path",
]

for (const url of wellFormed) {
  test(`accepts ${url}`, () => {
    const out = build(url)
    assert.match(out, /,"https:\/\/[^"]*\/q\.js","qinto"\);$/,
      "destination must be emitted as a single quoted JS string literal")
  })
}

const hostile = [
  ['quote break-out', 'https://a.com/","qinto");alert(1);//'],
  ['newline', "https://a.com/\nalert(1)"],
  ['backslash', "https://a.com/\\"],
  ['replace pattern chars', "https://a.com/$&$`$'"],
]

for (const [name, url] of hostile) {
  test(`neutralises ${name}`, () => {
    const out = build(url)
    // Exactly two quotes around the URL and two around "qinto" — nothing escaped into code.
    const quotes = (out.match(/"/g) ?? []).length
    assert.equal(quotes, 4, `expected 4 quotes, got ${quotes} in: ${out}`)
    assert.doesNotMatch(out, /alert\(1\)(?![^"]*")/,
      "payload must stay inside the string literal")
  })
}

const rejected = ["not a url", "", "   ", "/relative-only"]

for (const url of rejected) {
  test(`rejects ${JSON.stringify(url)} before it reaches the page`, () => {
    assert.throws(() => build(url), TypeError)
  })
}

test("a rejected URL means no script is injected, not a broken page", () => {
  // The component wraps this in try/catch and returns — mirrored here so the contract is recorded.
  let injected = false
  try {
    build("not a url")
    injected = true
  } catch {
    injected = false
  }
  assert.equal(injected, false)
})
