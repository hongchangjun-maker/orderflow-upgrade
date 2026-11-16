import {runtimeValue} from '../../lib/security';
export const publicTestEnabled=()=>runtimeValue('ENVIRONMENT')==='staging'&&runtimeValue('PUBLIC_TEST_MODE')==='1';
export const testEntryUrl='https://orderflow-korea-upgrade-staging.hhongcjun.workers.dev/try';
