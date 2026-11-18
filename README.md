Source code for buyfinder.

Requires Redis, ElasticSearch and MongoDB.
Basic installs of those should be sufficient.

A sample env file has been provided.

What needs to be done: 
- A few shops have probably changed and their selectors need to be updated for them to work again
- Some other shops, notably AmiAmi, animota and Suruga-ya, are very unfriendly to bots and I wasn't able to get past their blocks, except Suruga-ya with Cloudflare's Browser Run action, but relying on it gets expensive.
- Figuring out a way to get an authenticated session on MFC to retrieve NSFW item data
- Making the admin interface a bit more usable and complete
- Maybe a way to let users submit listings if the crawler can't find them because of a block

## Running locally

Requirements: Node, pnpm, and Podman or Docker with ≥4 GB RAM for Elasticsearch.

```sh
cp sample.env .env               # then see "Environment" below
pnpm install
pnpm services up                 # MongoDB 7, Redis 7, Elasticsearch 8.17 in Podman containers
pnpm index-figures               # creates the Elasticsearch "figures" index (Ctrl+C once it's done; it doesn't exit by itself)
pnpm dev                         # Next.js on :3000, crawler API on :8000, BullMQ worker
```

Open http://localhost:3000 and paste an MFC item link (e.g. `https://myfigurecollection.net/item/663834`) or a JAN barcode into the search bar to add a figure; its page will then crawl the shops.

`pnpm services down|status|logs <mongo|redis|elastic>|nuke` manages the containers (`nuke` deletes the data too).

### Environment

For local use, only the service URLs and `NEXTAUTH_SECRET` are needed (`openssl rand -base64 32`). Point them at the containers: `MONGODB_URI=mongodb://localhost:27017/`, `REDIS_PORT=6379` (no Redis user/password), `ELASTICSEARCH_NODE=http://localhost:9200` (leave `ELASTICSEARCH_USER` unset, since security is disabled in the container).

Optional:
- `REACT_APP_EXCHANGE_RATES_DATA_API_KEY` ([exchangerate-api.com](https://www.exchangerate-api.com), free tier): required for converting prices between currencies.
- `EMAIL_*`: Gmail used for account activation emails. Without it, activate users manually: `podman exec buyfinder-mongo mongosh buyfinder --eval 'db.users.updateOne({email: "you@example.com"}, {$set: {activated: true, admin: true}})'`.
- `PROXY_*`: when unset, every shop is crawled from your own IP. Some shops (eBay, Yahoo Auctions, Lashinbang…) answer 403 without one.
- `CLOUDFLARE_*`: needed for shops flagged `useCloudflare` (Suruga-ya and its mirrors).
- Stripe, MFC credentials: not needed.

### Troubleshooting

- `Could not find Chrome (ver. …)` or `spawn Unknown system error -88`: puppeteer's Chrome download can fail to extract (seen on Node 26), leaving a ~200 KB app. Re-extract it manually:
  ```sh
  cd ~/.cache/puppeteer/chrome && V=<version from the error>
  rm -rf mac_arm-$V && mkdir mac_arm-$V && ditto -xk $V-chrome-mac-arm64.zip mac_arm-$V
  ```
- The crawler logs nothing per job by default. POST a job to `http://localhost:8000/getListings` with `{"shop": "...", "figure": {...}, "testMode": true}` to get verbose worker output.
- Shop results are cached for several hours. Use the refresh button on the figure page (admins can always refresh), or flush Redis: `podman exec buyfinder-redis redis-cli FLUSHALL`.

Contact me at buyfinder.moe@gmail.com if you are unsure about something about the website itself.
I won't be able to help you with more technical stuff like setting up your system.


