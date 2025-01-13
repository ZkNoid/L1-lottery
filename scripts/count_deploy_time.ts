const startSlot = 671260;
const startTimeStamp = 1736766256;

const expectedTimeStamp = 1736773200; // "Mon Jan 13 2025 13:00:00 GMT+0000"

const diff = (expectedTimeStamp - startTimeStamp) / (3 * 60);

console.log(startSlot + diff); // 671298
