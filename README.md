# Factory

Makes social posts for a product and hands them to a publisher. One brief is one post:
a product, a persona, an account, a format and an angle. Registries are files; briefs,
generations and costs are in the database.

## Run

```bash
npm run dev
```

Open the day, press **Plan day**, then **Run**. Keys: `j` `k` move, `←` `→` slides,
`a` approve, `x` reject, `r` run again, `[` `]` change day, `t` today.

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

## Publishing

Finished posts go to Mitsushiro's `/api/ingest/post`, which stores the slides in the
creator's folder and puts the post on her calendar; Mitsushiro's scheduler publishes
it. To switch an account on:

1. In Mitsushiro, set `INGEST_SECRET` and deploy the ingest route.
2. Connect the account to a creator in Mitsushiro's Socials.
3. Here, set `MITSUSHIRO_URL` and `MITSUSHIRO_INGEST_SECRET`, and in the account's
   registry file set `"status": "active"` and
   `"target": { "kind": "mitsushiro", "uid": "…", "model": "…" }`.

Until all three are done, a brief that passes review stays at Ready and says why.
