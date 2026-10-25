# @ourfairy/dsh-http

The product's HTTP transport envelope, in one place: the bounded JSON request
reader, the bearer credential parser, the JSON response writer, and the `post`
wrapper that fences the request, checks the method, parses the body and writes
the error envelope.

## `./http`

```js
import { bearerToken, postHandler, sendJson } from '@ourfairy/dsh-http/http'
```

`readJsonBody` is module-private; product routes reach it through `postHandler`.
Both are given the owning module's error class (`HttpError`) and error-code
prefix (`codePrefix`); the caller passes them explicitly, because the catch in
`postHandler` must see exactly one error type — the class that route declared —
so its own errors are answered as 4xx and nothing else is mistaken for them.

## Why the row is empty

The package's main entry is a dsh plugin row with an empty `inject` and an empty
`apply`. The row exists so the bundle declares and mounts the package: the
bundle's package set is its `package.json` dependencies, its row set is
`cordis.patch.yml`, and `doctor`'s `bundle packages` check reports a declared
package that no row mounts, and a row that mounts an undeclared package — both
cases are driven end to end in
[`tests/bundle-packages.test.mjs`](../../tests/bundle-packages.test.mjs). An
empty row is the smallest thing that puts the transport in both lists.

## Why it does not depend on identity

The transport knows nothing about users, invites or sessions. It was split out
of `@ourfairy/dsh-identity` so the product packages that only need
`postHandler`/`sendJson` can drop their identity dependency (#139, #140). Its
manifest has no `peerDependencies` field, and `src/http.ts` has no import
declarations of product packages: the module names no product package.

## Where the code lives

The sources are TypeScript under `src/`; the package publishes the build output
under `dist/`. `npm run build` in the repository root compiles them with the
TypeScript the pinned dsh checkout carries, and the manifest's `files` list
publishes `dist/**/*.js` and `dist/**/*.d.ts` — not `src/`. The profile install
therefore copies the compiled module, and the `./http` subpath resolves to
`dist/http.js`.
