# Data governance

Everything this project deploys can be read by anyone who knows the URL. That
is a decision rather than an oversight, and this page is the decision: what is
exposed, why it is acceptable today, what keeps it defensible, and the one fact
that would change the answer.

> The deployed data is invented, and it is public on purpose. The API stays
> unauthenticated. The controls that make that defensible — rate limiting, and
> gating the executable query console out of production — are being added.
> Authentication is the thing that changes if real family data ever lands here,
> and that is the trigger to revisit.

This is the *data governance* guardrail from step 0 of `docs/adoption.md`. It
is written down so that it can be found and argued with, instead of being
inherited as whatever nobody got around to changing.

---

## What is public

Checked on 2026-09-13 with `curl`, sending no credentials, from outside every
deployment:

| Request | Anonymous response |
| --- | --- |
| `GET api-production-53f7b.up.railway.app/health` | `200` — `{"ok":true,"people":44}` |
| `GET api-production-53f7b.up.railway.app/` | `200` — the API manual, **Run query** console included |
| `POST api-production-53f7b.up.railway.app/graphql` | `200` — `{ people { name } }` returns all 44 names |
| `GET api-production-53f7b.up.railway.app/graphql` | `404` — there is no IDE to open |
| `POST .../graphql` asking for `__schema` | `200` with errors — *"GraphQL introspection has been disabled"* |
| `GET family-tree-flame-ten.vercel.app/` | `200` — the web app |
| `GET family-tree-flame-ten.vercel.app/docs/` | `200` — the documentation, this page among it |
| `GET stevemarvell.github.io/boris/` | `404` — Pages is gone, see below |

Vercel's preview deployments are open as well, and deliberately so: an agent
reviewing a pull request has to be able to load one.

So: the whole tree, on demand, to anyone, in one unauthenticated POST.

## Why that is acceptable

`data/family.json` is invented. Forty-four people across four generations, each
one an id, a name, a list of parent ids and a spouse id — no dates, no places,
no addresses, no photographs, no contact details, and no correspondence to
anybody who exists. It is a test fixture that the application happens to serve.

What is public, then, is a plausible graph of names nobody has. Publishing it
costs nothing and buys the thing this project is for: a deployment that a
stranger, or an agent, can open and exercise without being issued a credential
first. The API manual's console is only useful because there is nothing behind
the door worth locking.

## What makes it defensible rather than merely unnoticed

Open is not the same as unguarded. What an anonymous caller can do is bounded
— by two controls already in place, and two being added:

- **A query depth limit.** `MAX_QUERY_DEPTH = 6` in
  `apps/api/src/api/schema.py`. A person's relationship fields are mutually
  recursive, so each extra level of nesting costs roughly 3.5x: a security
  review measured depth 8 at 3.1 CPU-seconds and depth 10 at 23.7s, against
  0.14s for the worst case depth 6 still admits. The deepest query the app or
  the manual ever sends is depth 3.
- **No introspection, and no IDE.** `API_ENVIRONMENT` in
  `apps/api/src/api/main.py` defaults to `production`, which disables schema
  introspection and serves no GraphiQL. It is never set on Railway, so the
  deployed behaviour is the default and a forgotten variable fails closed. Both
  are confirmed by the table above.
- **Rate limiting** — #48, in flight. The depth limit caps what one query
  costs and says nothing about a thousand cheap ones, which matters more than
  usual here: Railway has no WAF and the service sleeps when idle, so the
  container has to wake before it can refuse anything.
- **A gate on the query console** — #52, in flight. The API serves its own
  manual at its root, with a **Run query** button posting to `/graphql` on the
  same origin: a working console, no setup, no CORS negotiation. Gating it on
  `API_ENVIRONMENT` the way the IDE already is costs little and uses a
  mechanism that already exists.

One smaller decision belongs in the same list: `allow_queries_via_get=False`,
also in `api/main.py`. A GraphQL query is a short string that can trigger an
expensive resolution, so accepting one over GET would turn an `<img src>` on
any page on the internet into work this server has to do. It is off in both
environments.

## What is deliberately absent

Authentication. Every query is anonymous, and `/health` reports the size of the
tree to anyone who asks.

Adding it later is not one middleware line, because the CORS policy in
`apps/api/src/api/main.py` is written on the assumption that no credentials
ever travel:

```python
allow_methods=["GET", "POST", "OPTIONS"],
allow_headers=["content-type"],
```

There is no `allow_credentials`, and `content-type` is the only admitted
request header — an `Authorization` header would be refused at the preflight,
by a browser, before the API ever saw it. So authentication means revisiting
CORS in the same change. Anyone who splits the two will spend an afternoon
debugging a preflight.

## The trigger to revisit

Real data. One actual relative, one actual birth date, anything in
`data/family.json` that is not invented — and this decision is void rather than
in need of review. The trigger is the data changing, not the traffic changing:
nothing here should wait to be noticed first.

What that change has to cover, collected in one place so nobody has to
rediscover it:

- authentication on `/graphql`, and with it the CORS policy above;
- `/health` no longer reporting the tree size to anonymous callers;
- the manual's console gated out of production, or moved behind the same
  authentication;
- the Vercel deployment and its previews, which are open by the same
  reasoning and stop being defensible by it at the same moment.

## What going private did, and did not do

The repository went private on 2026-09-13. That made the source, the issue
tracker and the Actions logs unreadable to strangers, and it retired one real
risk: a `@claude` workflow that any stranger's comment could trigger. The
`author_association` guard in `.github/workflows/claude.yml` was what actually
carried that, and it stays.

It removed no published URL. Every row in the table above was checked *after*
the switch. Making the repository private changed who can read the source; it
changed nothing about who can read the data.

Two side effects are worth knowing, because both look like breakage:

- GitHub Actions minutes are billed now rather than free.
- GitHub Pages needs a paid plan on a private repository, which is why
  `stevemarvell.github.io/boris/` returns `404` and why everything it used to
  publish is served from Vercel, or from inside the API image, instead.

Visibility was never the control. If it had been, the table above would be
shorter.
