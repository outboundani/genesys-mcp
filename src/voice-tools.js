// Voice agent tool group: plug a third-party voice bot (ElevenLabs
// ElevenAgents today) into Genesys Cloud through the Audio Connector, then
// build_flow / publish_flow with a voice_agent block wire it into a call flow
// with a hand-off to a human queue.
//
// The vendor API key never travels through the chat: create_voice_connector
// reads it from the Worker secret ELEVENLABS_API_KEY and writes it straight
// into a Genesys credential. Responses never include it.
//
// Pointing a phone number at the flow stays a human step (Admin > Call
// Routing): the AI builds it, a human presses go.

import { GenesysError } from './genesys.js';

export const ELEVENLABS_BASE_URIS = {
  global: 'wss://api.elevenlabs.io/v1/convai/conversation/genesys',
  us: 'wss://api.us.elevenlabs.io/v1/convai/conversation/genesys',
  eu: 'wss://api.eu.residency.elevenlabs.io/v1/convai/conversation/genesys',
  in: 'wss://api.in.residency.elevenlabs.io/v1/convai/conversation/genesys',
};

const BASE_URI_RE = /^wss:\/\/[^\s/?#]+(\/[^\s]*)?$/;

async function audioConnectors(gc) {
  const { entities } = await gc.listAll('/api/v2/integrations', {}, { max: 200 });
  return entities.filter((i) => i.integrationType?.id === 'audio-connector');
}

function connectorSummary(i, cfg) {
  return {
    id: i.id,
    name: i.name,
    enabled: i.intendedState === 'ENABLED',
    state: i.reportedState?.effective || i.reportedState?.code || 'unknown',
    ...(cfg?.properties?.baseUri ? { baseUri: cfg.properties.baseUri } : {}),
    hasCredential: Boolean(cfg?.credentials?.audioHook?.id),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const VOICE_TOOLS = [
  {
    name: 'list_voice_connectors',
    description: 'List the Audio Connector integrations (voice bot connections, e.g. ElevenLabs) in this org: name, id, state, base URI, and whether a credential is attached. Use the name as voice_agent.connector in build_flow. The ElevenLabs agent on the other end must use u-law 8000 Hz (ulaw_8000) for both TTS output and user input audio.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (gc) => {
      const list = await audioConnectors(gc);
      const out = [];
      for (const i of list) {
        let cfg = null;
        try { cfg = await gc.get(`/api/v2/integrations/${i.id}/config/current`); } catch { /* config unreadable */ }
        out.push(connectorSummary(i, cfg));
      }
      return { total: out.length, connectors: out, note: out.length ? 'Pass a connector name as voice_agent.connector in build_flow.' : 'None yet: create_voice_connector adds one (ElevenLabs).' };
    },
  },
  {
    name: 'create_voice_connector',
    description: 'Create (or reuse) the Genesys Audio Connector integration that streams calls to an ElevenLabs agent (ElevenAgents). Sets the Base Connection URI, attaches the ElevenLabs API key from this server\'s ELEVENLABS_API_KEY secret (it never passes through the chat), and enables it. Idempotent by name: if a connector with that name exists, it is returned unchanged. One connector serves every ElevenLabs agent: the agent is chosen per flow by voice_agent.agent_id. The ElevenLabs agent itself must use μ-law 8000 Hz for both TTS output and user input audio.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Integration name (default "ElevenLabs")' },
        region: { type: 'string', enum: Object.keys(ELEVENLABS_BASE_URIS), description: 'ElevenLabs environment for the WebSocket (default global; eu/in only for data-residency workspaces)' },
        base_uri: { type: 'string', description: 'Override the WebSocket base URI (wss://...); leave unset for ElevenLabs' },
      },
      additionalProperties: false,
    },
    handler: async (gc, a, cfg) => {
      const name = String(a.name || 'ElevenLabs').trim();
      if (!name || name.length > 100) throw new GenesysError('name must be 1-100 characters.', 400);
      const baseUri = a.base_uri ? String(a.base_uri).trim() : ELEVENLABS_BASE_URIS[a.region || 'global'];
      if (!BASE_URI_RE.test(baseUri)) throw new GenesysError(`base_uri must be a wss:// URL (got "${baseUri}").`, 400);

      const existing = (await audioConnectors(gc)).find((i) => i.name?.toLowerCase() === name.toLowerCase());
      if (existing) {
        let current = null;
        try { current = await gc.get(`/api/v2/integrations/${existing.id}/config/current`); } catch { /* unreadable */ }
        return { created: false, reused: true, ...connectorSummary(existing, current), note: `A connector named "${name}" already exists, so it was left unchanged. Use it as voice_agent.connector.` };
      }

      const apiKey = cfg?.elevenLabsKey;
      if (!apiKey) {
        throw new GenesysError('This server has no ElevenLabs API key: the operator must set the Worker secret ELEVENLABS_API_KEY (npx wrangler secret put ELEVENLABS_API_KEY). The key is never accepted through the chat.', 412);
      }
      if ((await audioConnectors(gc)).length >= 5) throw new GenesysError('Genesys allows at most 5 Audio Connector integrations per org, and this org has 5. Reuse one (list_voice_connectors).', 409);

      const credential = await gc.post('/api/v2/integrations/credentials', {
        name: `${name} (ElevenLabs API key)`,
        type: { name: 'audioHook' },
        credentialFields: { apiKey },
      });
      const integration = await gc.post('/api/v2/integrations', { integrationType: { id: 'audio-connector' } });
      const current = await gc.get(`/api/v2/integrations/${integration.id}/config/current`);
      await gc.put(`/api/v2/integrations/${integration.id}/config/current`, {
        name,
        version: current.version,
        properties: { baseUri },
        advanced: {},
        notes: 'Created by genesys-mcp (create_voice_connector) for ElevenLabs ElevenAgents.',
        credentials: { audioHook: { id: credential.id } },
      });
      await gc.patch(`/api/v2/integrations/${integration.id}`, { intendedState: 'ENABLED' });

      let state = null;
      for (let i = 0; i < 6; i++) {
        await sleep(1500);
        state = await gc.get(`/api/v2/integrations/${integration.id}`);
        if (['ACTIVE', 'ERROR'].includes(state.reportedState?.code)) break;
      }
      const code = state?.reportedState?.code;
      return {
        created: true,
        id: integration.id,
        name,
        baseUri,
        state: state?.reportedState?.effective || code || 'pending',
        note: code === 'ACTIVE'
          ? `"${name}" is active. Use it as voice_agent.connector in build_flow, with the ElevenLabs agent id as voice_agent.agent_id. Architect can take a few minutes to offer the action after a brand new connector.`
          : `"${name}" was created but reports ${code || 'no state yet'}${state?.reportedState?.detail?.message ? `: ${state.reportedState.detail.message}` : ''}. Check it in Admin > Integrations.`,
      };
    },
  },
];

export const VOICE_WRITE_TOOLS = ['create_voice_connector'];

export const VOICE_TOOL_GROUP = {
  name: 'Voice Agents (Audio Connector)',
  icon: '🎙️',
  tools: VOICE_TOOLS.map((t) => t.name),
};
