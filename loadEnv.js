'use strict';

module.exports = () => {
  const lastArgument = process.argv[process.argv.length - 1];
  if (!lastArgument.includes('env:')) throw new Error('No env config provided');
  const envFileId = lastArgument.split('env:')[1];
  require('dotenv').config({ path: `.env.${envFileId}` });
};
