const startSlot = 672206;
const startTimeStamp = 1736936310;

// const expectedTimeStamp = 1736773200; // "Mon Jan 13 2025 13:00:00 GMT+0000"
// const expectedTimeStamp = 1736942400; // "Wed Jan 15 2025 12:00:00 GMT+0000"
const expectedTimeStamp = 1743422400; // Mon Mar 31 2025 12:00:00 GMT+0000

const diff = (expectedTimeStamp - startTimeStamp) / (3 * 60);

console.log(startSlot + diff); // Old: 671298 New: 672239 Week: 708239
