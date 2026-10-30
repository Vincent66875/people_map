// Write the raw mock data as JSON, exactly what the adapter receives, so the Jira
// shape can be inspected / diffed against a real /rest/api/3/search response.
// Output only: nothing in the app reads these files. Edit the .js fixtures instead.
import { writeFileSync } from 'node:fs';
import small from '../src/data/jiraMock.js';
import large from '../src/data/jiraMockLarge.js';

for (const [name, mock] of [['jira-raw.json', small], ['jira-raw-large.json', large]]) {
  writeFileSync(new URL(`../src/data/${name}`, import.meta.url), JSON.stringify(mock, null, 2));
  console.log(`wrote src/data/${name}: ${mock.users.length} users, ${mock.searchResponse.issues.length} issues`);
}
