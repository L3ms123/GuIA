import streamlit as st
import pandas as pd
from neo4j import GraphDatabase
import os
from dotenv import load_dotenv
from LLM.unresolved_questions import list_pending_questions, mark_question_resolved

# Load credentials
load_dotenv(dotenv_path="../KG/.env")

st.set_page_config(layout="wide")
st.title("Renaissance Museum: Admin Portal")

def get_driver():
    return GraphDatabase.driver(
        os.getenv("AURA_URI").replace("neo4j+s://", "neo4j+ssc://"), 
        auth=(os.getenv("AURA_USER"), os.getenv("AURA_PASSWORD"))
    )

def process_upload(node_type, file, id_col, cypher, sep=',', mapping=None):
    # 1. Reset pointer and load
    file.seek(0)
    if file.name.endswith('.csv'):
        try:
            df = pd.read_csv(file, sep=sep, encoding='utf-8')
        except UnicodeDecodeError:
            file.seek(0)
            df = pd.read_csv(file, sep=sep, encoding='latin1')
    else:
        df = pd.read_excel(file, header=1) # Skips the title row
    
    # 2. Clean headers (remove hidden spaces)
    df.columns = df.columns.str.strip()
    
    # 3. Apply mapping: Keep ONLY mapped columns and rename them
    if mapping:
        df = df[list(mapping.keys())].rename(columns=mapping)
    
    # 4. Validate
    if id_col not in df.columns:
        st.error(f"Error: Column '{id_col}' not found. Available columns: {list(df.columns)}")
        return
    
    st.write(f"### Processing {node_type}")
    st.dataframe(df.head(3))
    
    if st.button(f"Confirm & Relate {node_type}"):
        with get_driver().session() as session:
            count = 0
            for _, row in df.iterrows():
                # Convert only the cleaned data to dict
                params = row.where(pd.notnull(row), None).to_dict()
                if id_col in params: params.pop(id_col)
                session.run(cypher, id=str(row[id_col]), params=params)
                count += 1
            st.success(f"Successfully synced {count} nodes for {node_type}.")

def get_csv_template(data, sep=','):
    return pd.DataFrame(data).to_csv(index=False, sep=sep).encode('utf-8')

artpiece_columns = {
    "INV.": ["INV-001"],
    "AUTORIA": ["Name"],
    "DATACIÓ": ["Date"],
    "TÈCNICA / TIPOLOGIA": ["Technique"],
    "TÍTOL / DESCRIPCIÓ": ["Title"],
    "DESCRIPTION": ["Description"]
}

artist_columns = {"Author's Name": ["Name"], "Information": ["Bio"]}
technique_columns = {"Art Technique": ["Technique"], "Information": ["Desc"]}
visual_desc_columns = {
    "artwork_id": ["INV-001"], "title": ["Title"], "artist": ["Name"],
    "room_or_location": ["Location"], "visual_overview": ["Overview"],
    "audio_description": ["Audio text"], "background": ["Background detail"],
    "colors": ["Colors used"], "composition": ["Composition description"],
    "figures_gestures": ["Figures and gestures"], "foreground": ["Foreground details"],
    "language": ["en"], "materials_textures": ["Materials and textures"],
    "middle_ground": ["Middle ground details"], "model": ["Model name"],
    "mood_atmosphere": ["Mood/Atmosphere"], "objects_symbols": ["Objects/Symbols"],
    "reviewed": ["False"], "source": ["Source name"],
    "spatial_order": ["Spatial order"], "subject_matter": ["Subject matter"],
    "uncertainties": ["Any uncertainties"], "created_at": ["2026-01-01"],
    "updated_at": ["2026-01-01"]
}
curator_entity_config = {
    "Artist": {"id_property": "name", "properties": ["biography", "Information"]},
    "ArtPiece": {"id_property": "artwork_id", "alternate_id_property": "title", "properties": ["description", "dating", "artist", "technique", "title"]},
    "Technique": {"id_property": "name", "properties": ["description", "Information"]},
    "VisualDescription": {
        "id_property": "artwork_id",
        "properties": [
            "visual_overview", "audio_description", "background", "colors", "composition",
            "figures_gestures", "foreground", "materials_textures", "middle_ground",
            "mood_atmosphere", "objects_symbols", "spatial_order", "subject_matter", "uncertainties"
        ]
    }
}
# --- APP LAYOUT ---
tabs = st.tabs(["ArtPiece", "VisualDescription", "Artist", "Technique", "Unresolved Questions", "📁 Templates & Instructions"])

with tabs[0]:
    st.subheader("ArtPiece Upload")
    st.download_button("Download ArtPiece Template", get_csv_template(artpiece_columns), "ArtPiece_Template.csv")
    file = st.file_uploader("Upload ArtPiece", type=['xlsx', 'csv'], key="art")
    if file:
        # 1. Define mapping to clean data and rename to Neo4j keys
        art_mapping = {
            "INV.": "artwork_id",
            "AUTORIA": "artist",
            "DATACIÓ": "dating",
            "TÈCNICA / TIPOLOGIA": "technique",
            "TÍTOL / DESCRIPCIÓ": "title",
            "DESCRIPTION": "description"
        }
        
        # 2. Cypher query uses the RENAME keys ($params.artist, $params.technique)
        cypher = """
        MERGE (a:ArtPiece {artwork_id: $id}) 
        SET a += $params
        WITH a
        // Connect to Artist
        OPTIONAL MATCH (ar:Artist {name: $params.artist})
        FOREACH (_ IN CASE WHEN ar IS NOT NULL THEN [1] ELSE [] END | MERGE (a)-[:CREATED_BY]->(ar))
        // Connect to Technique
        OPTIONAL MATCH (t:Technique {name: $params.technique})
        FOREACH (_ IN CASE WHEN t IS NOT NULL THEN [1] ELSE [] END | MERGE (a)-[:USES_TECHNIQUE]->(t))
        """
        
        # 3. Call process_upload with the mapping to filter and rename columns
        process_upload("ArtPiece", file, 'artwork_id', cypher, mapping=art_mapping)

with tabs[1]:
    st.subheader("VisualDescription Upload")
    st.download_button("Download VisualDescription Template", get_csv_template(visual_desc_columns), "Visual_Template.csv")
    file = st.file_uploader("Upload VisualDescription.csv", type=['csv'], key="vd")
    if file:
        cypher = """
        MATCH (a:ArtPiece {artwork_id: $id})
        MERGE (vd:VisualDescription {artwork_id: $id}) SET vd += $params
        MERGE (a)-[:HAS_VISUAL_DESCRIPTION]->(vd)
        """
        process_upload("VisualDescription", file, 'artwork_id', cypher, sep=',')

with tabs[2]:
    st.subheader("Artist Upload")
    st.download_button("Download Artist Template", get_csv_template(artist_columns, ';'), "Artist_Template.csv")
    file = st.file_uploader("Upload AuthorInfo.csv", type=['csv'], key="artist")
    if file:
        # Used "Author's Name" to match your actual CSV header
        cypher = """
        MERGE (a:Artist {name: $id}) SET a += $params
        WITH a
        OPTIONAL MATCH (art:ArtPiece {artist: a.name})
        FOREACH (_ IN CASE WHEN art IS NOT NULL THEN [1] ELSE [] END | MERGE (art)-[:CREATED_BY]->(a))
        """
        process_upload("Artist", file, "Author's Name", cypher, sep=';')

with tabs[3]:
    st.subheader("Technique Upload")
    st.download_button("Download Technique Template", get_csv_template(technique_columns, ';'), "Tech_Template.csv")
    file = st.file_uploader("Upload Tech.csv", type=['csv'], key="tech")
    if file:
        cypher = """
        MERGE (t:Technique {name: $id}) SET t += $params
        WITH t
        OPTIONAL MATCH (a:ArtPiece) WHERE a.technique = t.name
        FOREACH (_ IN CASE WHEN a IS NOT NULL THEN [1] ELSE [] END | MERGE (a)-[:USES_TECHNIQUE]->(t))
        """
        process_upload("Technique", file, 'Art Technique', cypher, sep=';')

with tabs[4]:
    st.subheader("Unresolved Questions")
    st.write("Review questions GuIA could not answer. Accepted information updates an existing museum graph entity.")
    unresolved_questions = list_pending_questions()
    if not unresolved_questions:
        st.info("No unresolved questions are waiting for review.")
    for question in unresolved_questions:
        question_id = question["id"]
        with st.expander(question["question"]):
            st.caption(f"Language: {question.get('language') or '-'} | Room: {question.get('roomId') or '-'} | Artwork: {question.get('artworkId') or '-'} | Asked: {question.get('askCount', 1)}")
            inferred_updates = question.get("inferredUpdates") or []
            submitted_updates = []
            for index, update in enumerate(inferred_updates):
                if update["kind"] == "property":
                    field_label = f"{update['propertyName'].replace('_', ' ').title()} of {update.get('fieldSubject') or update['entityLabel']}"
                else:
                    field_label = f"{update['targetLabel']} linked by {update['relationshipType'].replace('_', ' ').title()}"
                st.markdown(f"**{field_label}**")
                entity_id = update.get("entityId") or st.text_input("Existing entity identifier", key=f"entity-id-{question_id}-{index}")
                if update["kind"] == "property":
                    value = st.text_area("Missing information", key=f"value-{question_id}-{index}")
                    submitted_updates.append((update, entity_id, value))
                else:
                    target_id = st.text_input("Existing relationship target identifier", key=f"target-{question_id}-{index}")
                    submitted_updates.append((update, entity_id, target_id))
            if not inferred_updates:
                st.error("The failed query did not identify a supported missing graph field.")
            accept_col, reject_col = st.columns(2)
            with accept_col:
                if st.button("Accept and update graph", key=f"accept-{question_id}", disabled=not inferred_updates):
                    if any(not entity_id.strip() or not value.strip() for _, entity_id, value in submitted_updates):
                        st.error("Complete all missing-information fields.")
                    else:
                        with get_driver().session() as session:
                            results = []
                            for update, entity_id, value in submitted_updates:
                                config = curator_entity_config[update["entityLabel"]]
                                match_condition = f"n.{config['id_property']} = $entity_id"
                                if config.get("alternate_id_property"):
                                    match_condition += f" OR n.{config['alternate_id_property']} = $entity_id"
                                if update["kind"] == "property":
                                    result = session.run(
                                        f"MATCH (n:{update['entityLabel']}) WHERE {match_condition} SET n += $properties RETURN elementId(n) AS id",
                                        entity_id=entity_id.strip(), properties={update["propertyName"]: value.strip()}
                                    ).single()
                                else:
                                    target_config = curator_entity_config[update["targetLabel"]]
                                    result = session.run(
                                        f"""
                                        MATCH (n:{update['entityLabel']}) WHERE {match_condition}
                                        MATCH (target:{update['targetLabel']} {{{target_config['id_property']}: $target_id}})
                                        MERGE (n)-[:{update['relationshipType']}]->(target)
                                        RETURN elementId(n) AS id
                                        """,
                                        entity_id=entity_id.strip(), target_id=value.strip()
                                    ).single()
                                results.append(result)
                        if all(results):
                            mark_question_resolved(question_id, "accepted")
                            st.rerun()
                        else:
                            st.error("The selected graph entity or relationship target was not found.")
            with reject_col:
                if st.button("Reject", key=f"reject-{question_id}"):
                    mark_question_resolved(question_id, "rejected")
                    st.rerun()

with tabs[5]:
    st.subheader("Instructions for Admin Users")
    st.markdown("""
    ### How to use this portal:
    1. **Download Templates:** Click the buttons below to get correctly formatted CSV/Excel files. **Do not change the header names** in these files.
    2. **Prepare Your Data:** - **Artist/Technique:** Must use a semicolon `;` as the separator.
       - **Visual Description:** Must use a comma `,` as the separator.
    3. **Upload & Relate:** Go to the specific tab for your file type and upload. The portal will automatically:
       - Update existing nodes (no duplicates).
       - Create new connections (Artist-to-ArtPiece, Technique-to-ArtPiece, etc.).
       - Sync new properties.
       - The names of the columns in your upload must match exactly with the template for the relationships to be created correctly.
    """)
    
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.download_button("ArtPiece Template", get_csv_template(artpiece_columns), "ArtPiece_Template.csv")
    with col2:
        st.download_button("Artist Template", get_csv_template(artist_columns, ';'), "Artist_Template.csv")
    with col3:
        st.download_button("Technique Template", get_csv_template(technique_columns, ';'), "Tech_Template.csv")
    with col4:
        st.download_button("VisualDesc Template", get_csv_template(visual_desc_columns, ','), "Visual_Template.csv")
