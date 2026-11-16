# Factory

Makes social posts for a product and hands them to a publisher. One brief is one post:
a product, a persona, an account, a format and an angle. Registries are files; briefs,
generations and costs are in the database.

## Run

```bash
npm run dev
```

Sign in, open a product, press **Plan day**, then **Run**. Keys: `j` `k` move, `←` `→`
slides, `a` approve, `x` reject, `r` run again, `g` day or wall, `[` `]` change day, `t` today.

## Layout

```
registry/            the six registries, as files
  products/<id>/     product.json, filters.json
  personas/          who is talking, and what they can do
  accounts/          where posts go, how many a day, at what times
  formats/           a recipe of scenes, and what it requires
  angles/            hooks, and how a caption is put together
src/factory/         the pipeline
  planner.ts         the day's briefs
  pipeline.ts        planned → generating → reviewing → ready → published
  stages/            transform, judge, compose, publish
  scenes/            the visual building blocks a format is made of
src/ui/              the one screen
data/                local database and media (not in git)
```

A new format is a new file in `registry/formats` over existing scenes. A new persona
is a file in `registry/personas`; every format whose `requires` it satisfies becomes
available to its accounts. A new product is a folder in `registry/products`.

## Import from Opaque Ads

```bash
npm run import:opaqueads
```

Reads `~/OpaqueAds` and the Mac app's filter catalog. Stop the dev server first: the
embedded database is one process at a time.

## Accounts and publishing

Mitsushiro holds every account's sign-in and does the posting. Each persona here is one
creator there; each of its four platforms is a slot that is empty until an account is
connected. In the Accounts view: link a persona to a creator (or make a new one), then
Connect each platform. That goes through Mitsushiro's own platform apps and callback
addresses and comes back here.

To switch it on:

1. In Mitsushiro, merge the factory ingest routes and set `INGEST_SECRET` and
   `INGEST_OWNER` (your account's email).
2. Here, set `MITSUSHIRO_URL` and `MITSUSHIRO_INGEST_SECRET` (the same secret).

A connected account is planned for every day. A brief that passes review is handed to
Mitsushiro, which posts it at its time. Until then it stays at Ready and says why.

## The cloud

On a laptop the database and media are in `/data`. With `DATABASE_URL` (Neon) and
`BLOB_READ_WRITE_TOKEN` (Vercel Blob) set, both live in the cloud, for the deployment
and for this Mac alike.

```bash
vercel env pull .env.local
npm run sync:cloud
```

The first pulls the project's settings; the second copies this Mac's posts and media up.
Stop the dev server before the second.

Videos are made with ffmpeg: the one shipped with the app, or `FFMPEG_PATH`.
