"""Helpers added for persona-aware prompt construction and future graph-context injection."""

LANGUAGE_NAMES = {
    "en": "English",
    "es": "Spanish",
    "ca": "Catalan",
}

LANGUAGE_INSTRUCTIONS = {
    "en": (
        "Use natural English throughout the answer."
    ),
    "es": (
        "Usa un espanol natural y claro durante toda la respuesta. No cambies de idioma salvo que el visitante lo pida."
    ),
    "ca": (
        "Fes servir un catala natural i fluid durant tota la resposta. No canviis al castella si el visitant no ho demana."
    ),
}

PERSONA_INSTRUCTIONS = {
    "artist": (
        "Focus on artistic technique, materials, composition, and creative decisions. "
        "Explain how the work may have been made and what visual choices matter most."
    ),
    "storyteller": (
        "Lead with narrative energy. Highlight people, events, symbolism, legends, "
        "and memorable details that make the artwork easy to remember."
    ),
    "explorer": (
        "Be practical and visitor-oriented. Surface the most important takeaway quickly, "
        "connect the artwork to the room, and suggest what to notice next."
    ),
    "scholar": (
        "Give rigorous historical and cultural context. Use precise museum language, "
        "compare influences when useful, and explain why the piece matters."
    ),
}

AGE_INSTRUCTIONS = {
    "child": (
        "Use short sentences, concrete words, and a curious tone. Avoid jargon and turn "
        "abstract ideas into simple visual observations."
    ),
    "teen": (
        "Keep the tone clear, engaging, and intelligent. Explain meaning without sounding "
        "childish, and connect details to bigger themes when useful."
    ),
    "adult": (
        "Use a balanced museum-guide tone with moderate detail, direct structure, and "
        "no unnecessary simplification."
    ),
    "senior": (
        "Use calm, clear phrasing with a slightly slower rhythm. Favor short paragraphs, "
        "explicit transitions, and easy-to-follow structure."
    ),
}


def build_system_prompt(language, persona, age, context):
    """Create the system prompt from the frontend selections and current museum context."""
    response_language = LANGUAGE_NAMES.get(language, "Catalan")
    language_instruction = LANGUAGE_INSTRUCTIONS.get(
        language,
        "Use the requested language consistently.",
    )
    persona_instruction = PERSONA_INSTRUCTIONS.get(
        persona,
        "Use a balanced museum-guide tone that is informative and easy to follow.",
    )
    age_instruction = AGE_INSTRUCTIONS.get(
        age,
        "Use a neutral museum-guide tone for a general audience.",
    )

    room = (context or {}).get("room", "")
    artwork = (context or {}).get("artwork", "")

    context_lines = []
    if room:
        context_lines.append(f"- Current room: {room}")
    if artwork:
        context_lines.append(f"- Current artwork: {artwork}")
    if not context_lines:
        context_lines.append("- No room or artwork has been selected yet.")

    return "\n".join(
        [
            "You are GuIA, an adaptive museum guide for the Museu del Renaixement.",
            f"Always answer in {response_language}.",
            language_instruction,
            "",
            f"Guide persona: {persona or 'general museum guide'}.",
            persona_instruction,
            "",
            f"Visitor profile: {age or 'general visitor'}.",
            age_instruction,
            "",
            "Museum context:",
            *context_lines,
            "",
            "Knowledge graph / RAG rules:",
            "- Treat any retrieved graph context provided with the request as the authoritative source of facts.",
            "- If the retrieved context is missing or insufficient, say that clearly instead of inventing details.",
            "- Do not fabricate artwork titles, authors, dates, locations, or historical claims.",
            "- If the visitor refers to this artwork or here, use the selected room or artwork as the default referent when available.",
            "",
            "Response style rules:",
            "- Keep answers concise by default.",
            "- Use short paragraphs and clear structure.",
            "- Ask at most one follow-up question, and only if it genuinely helps the visitor.",
        ]
    )


def build_messages(message, persona, age, language, context, history=None, graph_context=""):
    """Assemble the full chat payload sent to Ollama, keeping graph context optional."""
    history = history or []
    messages = [{"role": "system", "content": build_system_prompt(language, persona, age, context)}]

    if graph_context:
        messages.append(
            {
                "role": "system",
                "content": f"Authoritative knowledge-graph context for this turn:\n{graph_context}",
            }
        )

    for item in history:
        role = item.get("role")
        text = item.get("text", "")
        if role in {"user", "assistant"} and text:
            messages.append({"role": role, "content": text})

    messages.append({"role": "user", "content": message})
    return messages
