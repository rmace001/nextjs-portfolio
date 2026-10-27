import { exchangeHostedCode, verifyHostedRead } from './yahoo-hosted-access.mjs';
import { tokenHandoffPage } from './yahoo-oauth.mjs';

export async function verifiedHandoffPage(code, config, dependencies = {}) {
    const exchangeCode = dependencies.exchangeCode ?? exchangeHostedCode;
    const verifyRead = dependencies.verifyRead ?? verifyHostedRead;
    const renderHandoff = dependencies.renderHandoff ?? tokenHandoffPage;

    const access = await exchangeCode(code, config);
    await verifyRead(access.accessToken);
    return renderHandoff(access.accessToken, access.refreshToken, access.expiresAt);
}
