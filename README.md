# GuIA - Adaptive AI Museum Audio Guide 🎧🤖

## Overview
This project proposes an adaptive AI-powered museum audio guide that provides interactive spoken dialogue and personalized explanations using AI designed to improve the traditional museum visiting experience.

The guide is implemented as a web platform and operates mainly through a chat (spoken or written) interface with audio integrated, allowing natural interaction for visitors of all age groups.

## Architecture 🏗️

### Knowledge Representation Graph 🕸️

The system uses a Knowledge Representation (KR) graph built from curated museum data.
The graph contains:
- Exhibit information
- Historical context
- Relationships between objects
- Physical locations in the museum

This ensures:
- Factual accuracy
- Institutional reliability
- Consistent explanations

### RAG + LLM Architecture ⚙️🤖
The system uses Retrieval-Augmented Generation (RAG) connected to a prebuilt Large Language Model (LLM).

Workflow:
1.  User asks a question
2.  Relevant data is retrieved from the KR graph
3.  Retrieved data is sent to the LLM
4.  The LLM generates a natural language response


## Persoanlization 🎯

### 1. Contextual adaptation

The system adapts explanations according to the visitor profile. Examples:
- Children → simpler language, gamification
- Adults → standard explanations
- Experts → more in deep explainations
- Elderly users → slower speech, clearer structure
- Interests are also taken into account as promts

This transforms the experience from a static guide into a customized educational interaction.

### 2. Multilingual Support 🌍
Supported languages:
- English
- Spanish
- Catalan
 
### 3. Accesibility ♿
The system is designed to be accessible to users with different needs and abilities.

Accessibility features include:
- Voice interaction for users with limited vision or reading difficulties
- Text chat for users with hearing impairments
- Adjustable speech speed and volume
- Clear and simplified language modes
- Multilingual support for non-native speakers
- High-contrast and readable interface design

These features ensure that the museum experience is inclusive and usable for the widest possible audience.






