import path from 'path';
import { readdir, stat, copyFile, writeFile } from 'fs/promises';

const directory = 'cache';

const files = await readdir(directory);
const stats = await Promise.all(
  files.map((file) => stat(path.join(directory, file)))
);

const filesToInclude = files.filter((x, i) => stats[i].size < 100_000_000);

for (let fileToInclude of filesToInclude) {
  await copyFile(`cache/${fileToInclude}`, `cache_frontend/${fileToInclude}`)
}

await writeFile("cache_frontend/cache_list.json", JSON.stringify(filesToInclude, null, 2));

