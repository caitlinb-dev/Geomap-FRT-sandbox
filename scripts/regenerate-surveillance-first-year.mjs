import { runRefresh } from './refresh-facial-recognition-stories.mjs';

runRefresh().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
