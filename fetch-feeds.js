// EVF SecDef Radar — Feed Fetcher
// Runs daily via GitHub Actions, writes feeds.json to repo root
// GitHub Actions fetches server-side so no CORS issues

const https = require('https');
const http = require('http');
const { parseString } = require('xml2js');
const fs = require('fs');

const NEWS_FEEDS = [
  { name: 'SpaceNews', url: 'https://spacenews.com/feed/' },
  { name: 'Breaking Defense', url: 'https://breakingdefense.com/feed/' },
  { name: 'Defense News', url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml' },
  { name: 'SpaceWatch Global', url: 'https://spacewatch.global/feed/' },
  { name: 'European Spaceflight', url: 'https://europeanspaceflight.com/feed/' },
  { name: 'Payload Space', url: 'https://payloadspace.com/feed/' },
  { name: 'Satnews', url: 'https://satnews.com/feed/' },
  { name: 'Via Satellite', url: 'https://www.satellitetoday.com/feed/' },
  { name: 'Orbital Today', url: 'https://orbitaltoday.com/feed/' },
  { name: 'Euractiv', url: 'https://www.euractiv.com/feed/' },
  { name: 'Euractiv Defence', url: 'https://www.euractiv.com/sections/defence-and-security/feed/' },
  { name: 'Euractiv Space', url: 'https://www.euractiv.com/sections/space/feed/' },
  { name: 'EU Observer', url: 'https://euobserver.com/rss.xml' },
  { name: 'Politico Europe', url: 'https://www.politico.eu/feed/' },
  { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/' },
  { name: 'Defense One', url: 'https://www.defenseone.com/rss/all/' },
  { name: 'C4ISRNET', url: 'https://www.c4isrnet.com/arc/outboundfeeds/rss/?outputType=xml' },
  { name: 'EO Mag', url: 'https://eomag.eu/feed/' },
  { name: 'Geospatial World', url: 'https://www.geospatialworld.net/feed/' },
];

const TENDER_FEEDS = [
  { name: 'TED Defence & Security', url: 'https://ted.europa.eu/en/simap/rss-feed/-/rss/search/defe' },
  { name: 'TED R&D Services', url: 'https://ted.europa.eu/en/simap/rss-feed/-/rss/search/reco' },
];

const RELEVANCE_KEYWORDS = [
  'esa', 'edf', 'eda', 'satcen', 'euspa', 'frontex', 'eurosur', 'copernicus',
  'galileo', 'sentinel', 'govsatcom', 'iris', 'eogs',
  'geoint', 'osint', 'imint', 'isr', 'geospatial', 'reconnaissance',
  'earth observation', 'satellite image', 'sar satellite', 'remote sensing',
  'european defence', 'european defense', 'eu defence', 'eu defense',
  'defence fund', 'defense fund', 'dual-use', 'space security',
  'space defence', 'space defense', 'border surveillance',
  'maritime surveillance', 'csdp', 'edip', 'dg defis',
  'airbus defence', 'telespazio', 'thales alenia', 'leonardo space',
  'gmv', 'novaspace', 'e-geos', 'rhea group', 'tracasa',
  'space domain awareness', 'space situational awareness',
  'navwar', 'c4isr', 'information superiority',
  'european rearmament', 'defence spending', 'defence budget',
  'nato diana', 'hypersonic', 'ukraine space',
];

const TENDER_KEYWORDS = [
  'space', 'satellite', 'copernicus', 'galileo', 'sentinel',
  'earth observation', 'geoint', 'osint', 'imint', 'isr',
  'geospatial', 'reconnaissance', 'surveillance',
  'border', 'frontex', 'eurosur', 'maritime', 'intelligence',
  'esa', 'eda', 'euspa', 'satcen', 'dg defis', 'edf',
  'exploitation', 'dissemination', 'dual-use',
  'defence advisory', 'defense advisory',
];

function isRelevant(title, desc, keywords) {
  const text = ((title || '') + ' ' + (desc || '')).toLowerCase();
  return keywords.some(kw => text.includes(kw));
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'EVF-SecDef-Radar/1.0 (RSS reader)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      }
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseRSS(xml, feedName) {
  return new Promise((resolve) => {
    parseString(xml, { explicitArray: false, ignoreAttrs: false }, (err, result) => {
      if (err || !result) return resolve([]);
      try {
        // Handle RSS 2.0
        const channel = result.rss?.channel;
        if (channel) {
          const items = Array.isArray(channel.item) ? channel.item : [channel.item].filter(Boolean);
          return resolve(items.map(item => ({
            title: item.title || '',
            link: item.link || '',
            pubDate: item.pubDate || item['dc:date'] || '',
            description: (item.description || item['content:encoded'] || '').replace(/<[^>]+>/g, '').substring(0, 300),
            feedName,
          })));
        }
        // Handle Atom
        const feed = result.feed;
        if (feed) {
          const entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry].filter(Boolean);
          return resolve(entries.map(entry => ({
            title: typeof entry.title === 'object' ? entry.title._ : (entry.title || ''),
            link: Array.isArray(entry.link) ? (entry.link.find(l => l.$?.rel === 'alternate')?.$?.href || entry.link[0]?.$?.href || '') : (entry.link?.$?.href || ''),
            pubDate: entry.published || entry.updated || '',
            description: (typeof entry.summary === 'object' ? entry.summary._ : (entry.summary || '')).replace(/<[^>]+>/g, '').substring(0, 300),
            feedName,
          })));
        }
        resolve([]);
      } catch(e) {
        resolve([]);
      }
    });
  });
}

async function fetchFeed(feed, keywords) {
  try {
    const xml = await fetchUrl(feed.url);
    const items = await parseRSS(xml, feed.name);
    return items.filter(item => isRelevant(item.title, item.description, keywords));
  } catch(e) {
    console.log(`  FAILED: ${feed.name} — ${e.message}`);
    return [];
  }
}

async function main() {
  console.log('EVF SecDef Radar — fetching feeds...\n');

  // Fetch news feeds
  console.log('NEWS FEEDS:');
  const newsResults = await Promise.all(
    NEWS_FEEDS.map(f => fetchFeed(f, RELEVANCE_KEYWORDS).then(items => {
      console.log(`  ${items.length > 0 ? '✓' : '✗'} ${f.name}: ${items.length} relevant items`);
      return items;
    }))
  );

  let newsItems = newsResults.flat();
  // Deduplicate by link
  const seenLinks = new Set();
  newsItems = newsItems.filter(item => {
    if (seenLinks.has(item.link)) return false;
    seenLinks.add(item.link);
    return true;
  });
  // Sort by date, newest first
  newsItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  newsItems = newsItems.slice(0, 50);
  console.log(`\nTotal relevant news items: ${newsItems.length}`);

  // Fetch tender feeds
  console.log('\nTENDER FEEDS:');
  const tenderResults = await Promise.all(
    TENDER_FEEDS.map(f => fetchFeed(f, TENDER_KEYWORDS).then(items => {
      console.log(`  ${items.length > 0 ? '✓' : '✗'} ${f.name}: ${items.length} relevant items`);
      return items;
    }))
  );

  let tenderItems = tenderResults.flat();
  const seenTenders = new Set();
  tenderItems = tenderItems.filter(item => {
    if (seenTenders.has(item.link)) return false;
    seenTenders.add(item.link);
    return true;
  });
  tenderItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  tenderItems = tenderItems.slice(0, 30);
  console.log(`Total relevant tender items: ${tenderItems.length}`);

  // Write output
  const output = {
    generated: new Date().toISOString(),
    newsItems,
    tenderItems,
  };

  fs.writeFileSync('feeds.json', JSON.stringify(output, null, 2));
  console.log('\n✓ feeds.json written successfully');
  console.log(`  ${newsItems.length} news items, ${tenderItems.length} tender items`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  // Write empty but valid JSON so dashboard doesn't break
  fs.writeFileSync('feeds.json', JSON.stringify({
    generated: new Date().toISOString(),
    newsItems: [],
    tenderItems: [],
    error: e.message,
  }));
  process.exit(1);
});
