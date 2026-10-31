// Pure helpers embedded in Code nodes. Keep each exported function self-contained.
// Adapted from Lamelas: serialized helpers, verified handoff, defensive summary.
export function validateEntry(input, kind) {
  const body = input?.body;
  const field = kind === 'event' ? 'event_id' : 'turn_id';
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => key !== field) ||
      typeof body[field] !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body[field])) {
    return { valid: false, error: 'Entrada inválida', field };
  }
  return { valid: true, [field]: body[field] };
}

export function validateConfig(config) {
  // No URL global dependency: Code-node sandboxes differ between n8n versions.
  const match = typeof config.api_base_url === 'string' &&
    config.api_base_url.match(/^https:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(:\d{1,5})?\/?$/i);
  // Reject known legacy/other-service hosts, while allowing a dedicated UNSTA host.
  // This origin is operator configuration, never taken from webhook/user input.
  if (!match || match[1].endsWith('.invalid') ||
      ['inmobiliarialyc.com.ar', 'api.inmobiliarialyc.com.ar', 'n8n.inmobiliarialyc.com.ar', 'evoapi.inmobiliarialyc.com.ar'].includes(match[1].toLowerCase())) {
    throw new Error('CONFIGURAR_BACKEND_UNSTA: se requiere origen HTTPS propio de UNSTA');
  }
  return { ...config, api_base_url: config.api_base_url.replace(/\/$/, '') };
}

export function validateClaim(input, entry, kind) {
  const field = kind === 'event' ? 'event_id' : 'turn_id';
  if (!input || typeof input.claimed !== 'boolean' || input[field] !== entry[field]) {
    throw new Error('CLAIM_INVALIDO');
  }
  if (!input.claimed) return { claimed: false, [field]: entry[field] };
  if (typeof input.attempt_id !== 'string' || !input.attempt_id ||
      typeof input.attempt_token !== 'string' || input.attempt_token.length < 16) {
    throw new Error('CLAIM_INVALIDO');
  }
  return { claimed: true, [field]: entry[field], attempt_id: input.attempt_id, attempt_token: input.attempt_token };
}

export function prepareContext(input, claim, config, nowISO) {
  if (!input || input.turn_id !== claim.turn_id || input.attempt_id !== claim.attempt_id ||
      typeof input.conversation?.id !== 'string' || !Number.isInteger(input.conversation?.control_version) ||
      !['bot', 'esperando_humano', 'humano', 'cerrada'].includes(input.conversation.mode)) {
    throw new Error('CONTEXTO_INVALIDO');
  }
  if (input.conversation.mode !== 'bot') return { can_run: false, reason: 'control_humano' };
  if (input.knowledge_version !== config.knowledge_version || input.knowledge_hash !== config.knowledge_hash ||
      !Number.isInteger(input.context_sequence) || input.context_sequence < 1 ||
      !Array.isArray(input.messages) || input.messages.length > 20 ||
      !Array.isArray(input.catalog) || input.catalog.length > 30 ||
      typeof input.current_message?.id !== 'string' ||
      typeof input.current_message?.text !== 'string' || !input.current_message.text.trim() ||
      input.current_message.text.length > 6000 || input.current_message.role !== 'user' ||
      !Number.isInteger(input.current_message.sequence) || input.current_message.sequence > input.context_sequence ||
      (input.summary_through_sequence !== undefined && input.summary_through_sequence !== input.current_message.sequence)) throw new Error('CONTEXTO_INVALIDO');
  // Allowlist. Technical tokens and private notes must never enter the model prompt.
  const messages = input.messages.map(m => {
    if (!['user','assistant','operator'].includes(m.role) || typeof m.id !== 'string' ||
        typeof m.text !== 'string' || m.text.length > 6000 ||
        !Number.isInteger(m.sequence) || m.sequence > input.context_sequence) throw new Error('HISTORIAL_INVALIDO');
    return { id: m.id, role: m.role, text: m.text, sequence: m.sequence };
  });
  const visible = {
    fecha_actual: nowISO,
    zona_horaria: config.timezone,
    knowledge_version: input.knowledge_version,
    contacto: Object.fromEntries(['nombre','email','telefono','condicion'].filter(k => typeof input.contact?.[k] === 'string').map(k => [k, input.contact[k]])),
    intereses_registrados: (input.interests ?? []).slice(0, 20).map(r => ({propuesta_id:r.propuesta_id, propuesta_libre:r.propuesta_libre, sede:r.sede, modalidad:r.modalidad, periodo:r.periodo, etapa:r.etapa})),
    catalogo: input.catalog.map(r => ({ id: r.id, titulo: r.titulo, seccion: r.seccion })),
    resumen_anterior: input.summary ?? {},
    historial: messages.filter(m => m.id !== input.current_message.id),
    ultimo_intercambio: messages.filter(m => m.id !== input.current_message.id).slice(-2),
    mensaje_actual: { id: input.current_message.id, role: 'user', text: input.current_message.text, sequence: input.current_message.sequence }
  };
  const prompt_input = JSON.stringify(visible);
  if (prompt_input.length > 60000) throw new Error('CONTEXTO_DEMASIADO_EXTENSO');
  // A generic notice request after two courses must not silently select one.
  // This only generates a clarification; it never grants consent or writes.
  const normalized = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const courseKeys = input.catalog.filter(r=>r.seccion==='cursos').map(r=>({
    titulo:r.titulo,
    key:normalized(r.titulo).replace(/^(diplomatura|curso)\s+(en\s+)?/,'').split(/\s+/).slice(0,2).join(' ')
  }));
  const currentText=normalized(input.current_message.text);
  const previousText=normalized(visible.ultimo_intercambio.map(m=>m.text).join(' '));
  const mentioned=courseKeys.filter(r=>previousText.includes(r.key));
  const noticeAmbiguous=/\b(avisame|avisarme|avises|notificame)\b/.test(currentText) &&
    !courseKeys.some(r=>currentText.includes(r.key)) && mentioned.length>1;
  return {
    can_run: true, turn_id: claim.turn_id, attempt_id: claim.attempt_id,
    conversation_id: input.conversation.id, control_version: input.conversation.control_version,
    context_sequence: input.context_sequence, summary_through_sequence: input.summary_through_sequence ?? input.current_message.sequence, knowledge_version: input.knowledge_version,
    knowledge_hash: input.knowledge_hash,
    summary_due: input.summary_due === true,
    prompt_input,
    aviso_aclaracion: noticeAmbiguous ? mentioned.map(r=>r.titulo) : []
  };
}

export function prepareResponse(result, context) {
  function payload(value, depth = 0) {
    if (depth > 6) return null;
    if (typeof value === 'string') { try { return payload(JSON.parse(value), depth + 1); } catch { return null; } }
    if (!value || typeof value !== 'object' || value.error || value.isError === true) return null;
    if (Array.isArray(value)) return value.length === 1 ? payload(value[0], depth + 1) : null;
    if (value.ok === true && value.data && typeof value.data === 'object') return value;
    if (value.type === 'text') return payload(value.text, depth + 1);
    if (Array.isArray(value.content)) return payload(value.content, depth + 1);
    return null;
  }
  const steps = Array.isArray(result?.intermediateSteps) ? result.intermediateSteps : [];
  const attempts = steps.filter(s => s.action?.tool === 'derivar_a_area');
  const refs = new Set();
  for (const step of steps) {
    if (!['consultar_conocimiento','ver_propuesta'].includes(step.action?.tool)) continue;
    const data = payload(step.observation)?.data;
    if (data?.knowledge_version !== context.knowledge_version || data?.knowledge_hash !== context.knowledge_hash || !Array.isArray(data.registros)) continue;
    for (const record of data.registros) if (typeof record.id === 'string' && record.id.length <= 100) refs.add(record.id);
  }
  const base = {
    turn_id: context.turn_id, attempt_id: context.attempt_id,
    control_version: context.control_version, knowledge_version: context.knowledge_version,
    record_ids: [...refs].slice(0, 39), handoff_id: null
  };
  if (attempts.length) {
    const data = payload(attempts.at(-1).observation)?.data;
    const verified = data?.turn_id === context.turn_id && data?.attempt_id === context.attempt_id &&
      typeof data.caso?.id === 'string' && data.caso.id.length > 0 && data.caso.estado === 'pendiente' &&
      data.conversation?.id === context.conversation_id && data.conversation.mode === 'esperando_humano' &&
      data.conversation.control_version === context.control_version + 1;
    return {
      ...base,
      control_version: verified ? data.conversation.control_version : base.control_version,
      handoff_id: verified ? data.caso.id : null,
      texto: verified
        ? 'Tu consulta quedó derivada al equipo de esta demo. Está pendiente de atención en el panel; no se envió a la universidad.'
        : 'No pude confirmar el pase al equipo de la demo. Podés volver a intentarlo o usar el contacto oficial.'
    };
  }
  const texto = typeof result?.output === 'string' ? result.output.trim() : '';
  if (!texto || texto.length > 6000) throw new Error('RESPUESTA_INVALIDA');
  if (context.aviso_aclaracion?.length>1) return {...base,texto:`¿Para cuál de estas propuestas querés el aviso: ${context.aviso_aclaracion.join(' o ')}? El aviso será simulado y quedará solo en este panel.`};
  return { ...base, texto };
}

export function normalizeSummary(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { return null; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result = {};
  for (const [key,max] of [['nombre',200],['proximo_paso',300]]) {
    if (typeof raw[key] === 'string' && raw[key].trim()) result[key] = raw[key].trim().slice(0,max);
  }
  if (['ingresante','alumno','otro','no_declarado'].includes(raw.condicion)) result.condicion = raw.condicion;
  for (const [key,count,max] of [['intereses',10,200],['dudas_pendientes',10,300],['hechos_declarados',15,300]]) {
    if (!Array.isArray(raw[key])) continue;
    const seen = new Set();
    result[key] = raw[key].filter(v => typeof v === 'string').map(v => v.trim().slice(0,max)).filter(v => {
      const k = v.toLocaleLowerCase('es-AR');
      if (!k || seen.has(k)) return false;
      seen.add(k); return true;
    }).slice(0,count);
  }
  return Object.keys(result).length ? result : null;
}

export function normalizeError(input) {
  const data = input && typeof input === 'object' ? input : {};
  const execution = data.execution ?? {};
  const trigger = data.trigger ?? {};
  // Do not forward raw messages, stacks, URLs, request bodies or arbitrary node names.
  // IDs allow the backend to correlate the execution registered at claim time.
  const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null;
  const known = new Set(['reclamar_turno','obtener_contexto','Agente UNSTA','finalizar_turno','cancelar_turno',
    'Resumir conversacion','guardar_resumen','reclamar_evento','procesar_apertura',
    'consultar_conocimiento','ver_propuesta','actualizar_contacto','registrar_interes','gestionar_aviso','derivar_a_area']);
  const rawNode = execution.lastNodeExecuted ?? trigger.error?.node?.name;
  return {
    workflow_id: identifier(data.workflow?.id),
    execution_id: identifier(String(execution.id ?? '')),
    node: known.has(rawNode) ? rawNode : 'no_identificado',
    code: data.trigger ? 'N8N_TRIGGER_FAILURE' : 'N8N_EXECUTION_FAILURE',
    mensaje: 'Falló una ejecución de UNSTA. Revisar el turno correlacionado o la ejecución en n8n.'
  };
}
