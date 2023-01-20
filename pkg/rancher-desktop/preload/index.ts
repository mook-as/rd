import initExtensions from './extensions';

import Logging from '@pkg/utils/logging';

const console = Logging.preload;

async function init() {
  await initExtensions();
}

init().catch((ex) => {
  console.error(ex);
  throw ex;
});
