
require('dotenv').config({ path: '../../.env' });
const express = require('express');
const axios = require('axios');
const { IMessageSDK } = require('@photon-ai/imessage-kit');

const app = express();
const PORT = process.env.IMESSAGE_BRIDGE_PORT || 3001;
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:8081/api/v1/imessage/webhook';

app.use(express.json());

const sdk = new IMessageSDK({
    debug: true,
    watcher: {
        pollInterval: 2000, // Poll every 2 seconds
        unreadOnly: true,
        excludeOwnMessages: true,
    },

});

// Endpoint for sending outbound iMessages
app.post('/send', async (req, res) => {
    const { to, message, files, images } = req.body;

    if (!to || (!message && !files && !images)) {
        return res.status(400).json({ error: 'Recipient and either message, files or images are required.' });
    }

    try {
        console.log(`Sending message to ${to}: ${message || ''}`);
        await sdk.send(to, { text: message, files, images });
        res.json({ success: true, message: 'Message sent successfully.' });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start watching for new messages and send them to the webhook
async function startIMessageWatcher() {
    try {
        await sdk.startWatching({
            onDirectMessage: async (msg) => {
                console.log(`[iMessage Bridge] Received new direct message. Content: "${msg.text}", Sender: "${msg.sender}", ID: "${msg.id}"`);
                try {
                    const payload = {
                        text: msg.text,
                        from_phone: msg.sender,
                        to_phone: msg.recipient,
                        message_id: msg.id,
                        timestamp: msg.timestamp,
                        attachments: msg.attachments
                    };
                    await axios.post(WEBHOOK_URL, payload);
                    console.log(`[iMessage Bridge] Webhook POST to ${WEBHOOK_URL} successful for message ID: ${msg.id}.`);
                } catch (error) {
                    console.error(`[iMessage Bridge] Error sending webhook POST for message ID: ${msg.id}:`, error.message);
                }
            },
            onGroupMessage: async (msg) => {
                console.log(`[iMessage Bridge] Received new group message. Content: "${msg.text}", Sender: "${msg.sender}", ID: "${msg.id}"`);
                try {
                    const payload = {
                        text: msg.text,
                        from_phone: msg.sender,
                        to_phone: msg.recipient,
                        message_id: msg.id,
                        timestamp: msg.timestamp,
                        attachments: msg.attachments
                    };
                    await axios.post(WEBHOOK_URL, payload);
                    console.log(`[iMessage Bridge] Webhook POST to ${WEBHOOK_URL} successful for message ID: ${msg.id}.`);
                } catch (error) {
                    console.error(`[iMessage Bridge] Error sending webhook POST for message ID: ${msg.id}:`, error.message);
                }
            },
            onError: (error) => {
                console.error('IMessageSDK Error:', error);
            },
        });
        console.log('IMessageSDK started watching for new messages.');
    } catch (error) {
        console.error('Failed to start IMessageSDK:', error);
        process.exit(1);
    }
}

// Initialize and start the server
app.listen(PORT, async () => {
    console.log(`iMessage Bridge server listening on port ${PORT}`);
    await startIMessageWatcher();
});

process.on('SIGINT', async () => {
    console.log('Closing IMessageSDK...');
    await sdk.close();
    console.log('IMessageSDK closed. Exiting.');
    process.exit(0);
});
