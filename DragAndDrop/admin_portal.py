import streamlit as st
import pandas as pd
from neo4j import GraphDatabase
import os
from dotenv import load_dotenv

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

# --- APP LAYOUT ---
tabs = st.tabs(["ArtPiece", "VisualDescription", "Artist", "Technique", "📁 Templates & Instructions"])

with tabs[0]:
    st.subheader("ArtPiece Upload")
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
    
    def get_csv_template(data, sep=','):
        return pd.DataFrame(data).to_csv(index=False, sep=sep).encode('utf-8')

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

    col1, col2, col3 = st.columns(3)
    with col1:
        st.download_button("Artist Template", get_csv_template({"Author's Name": ["Name"], "Information": ["Bio"]}, ';'), "Artist_Template.csv")
    with col2:
        st.download_button("Technique Template", get_csv_template({"Art Technique": ["Technique"], "Information": ["Desc"]}, ';'), "Tech_Template.csv")
    with col3:
        st.download_button("VisualDesc Template", get_csv_template(visual_desc_columns, ','), "Visual_Template.csv")