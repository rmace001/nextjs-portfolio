(() => {
    history.replaceState(null, '', '/api/redirect');
    const tokenElement = document.querySelector('meta[name="yahoo-access-token"]');
    const button = document.querySelector('#save-token');
    const status = document.querySelector('#save-status');
    if (!tokenElement || !button || !status) return;

    const receiver = 'http://127.0.0.1:8765';
    let sending = false;

    button.addEventListener('click', async () => {
        if (sending) return;
        const accessToken = tokenElement.content;
        if (!accessToken) {
            status.textContent = 'This handoff has already been used. Reconnect Yahoo to get a fresh token.';
            button.disabled = true;
            return;
        }

        sending = true;
        button.disabled = true;
        status.textContent = 'Connecting to the local receiver…';
        try {
            const challengeResponse = await fetch(`${receiver}/challenge`, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-store',
                signal: AbortSignal.timeout(15000)
            });
            if (!challengeResponse.ok) throw new Error();
            const challengeData = await challengeResponse.json();
            if (typeof challengeData.challenge !== 'string' || challengeData.challenge.length < 32) throw new Error();

            const saveResponse = await fetch(`${receiver}/token`, {
                method: 'POST',
                mode: 'cors',
                cache: 'no-store',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Front-Office-Challenge': challengeData.challenge
                },
                body: JSON.stringify({ access_token: accessToken }),
                signal: AbortSignal.timeout(15000)
            });
            if (!saveResponse.ok) throw new Error();
            const result = await saveResponse.json();
            if (result.saved !== true) throw new Error();

            tokenElement.content = '';
            status.textContent = 'Token saved to the project .env file. You can close this page.';
        } catch {
            status.textContent = 'Could not save locally. Make sure python3 yahoo_token_receiver.py is running, then try again.';
            button.disabled = false;
        } finally {
            sending = false;
        }
    });
})();
