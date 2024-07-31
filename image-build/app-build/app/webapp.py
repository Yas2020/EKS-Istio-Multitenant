"""
A simple web application to implement a chatbot. This app uses Streamlit 
for the UI and the Python requests package to talk to an API endpoint that
implements text generation and Retrieval Augmented Generation (RAG) using
Amazon Bedrock and FAISS as the vector database.
"""
import os
from datetime import datetime
import boto3
import streamlit as st
import requests as req
from typing import List, Tuple, Dict
from streamlit.web.server.websocket_headers import _get_websocket_headers
import logging

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

from sessions import Sessions

table_name = os.getenv('SESSIONS_TABLE')
EMBEDDINGS_MODEL = os.environ.get('EMBEDDING_MODEL_ID')
TEXT2TEXT_MODEL_ID = os.environ.get('TEXT2TEXT_MODEL_ID')

# Create DynamoDB client
dynamodb = boto3.resource("dynamodb")

# global constants
STREAMLIT_SESSION_VARS: List[Tuple] = [("generated", []), ("past", []), ("input", ""), ("stored_session", [])]
HTTP_OK: int = 200

MODE_RAG: str = 'RAG'
MODE_VALUES: List[str] = [MODE_RAG]

TEXT2TEXT_MODEL_LIST: List[str] = [TEXT2TEXT_MODEL_ID]
EMBEDDINGS_MODEL_LIST: List[str] = [EMBEDDINGS_MODEL]

# API endpoint
api: str = "http://127.0.0.1:8000"
api_rag_ep: str = f"{api}/api/v1/llm/rag"
print(f"api_rag_ep={api_rag_ep}")

####################
# Streamlit code
####################

# Get request headers
headers = _get_websocket_headers()
tenantid = headers.get("X-Auth-Request-Tenantid")
user_email = headers.get("X-Auth-Request-Email")

tenant_id = tenantid + ":" + user_email
dyn_resource = boto3.resource('dynamodb')
IDLE_TIME = 600                                     # seconds
current_time = int(datetime.now().timestamp())

# Page title
st.set_page_config(page_title='Virtual assistant for knowledge base 👩‍💻', layout='wide')

# keep track of conversations by using streamlit_session
_ = [st.session_state.setdefault(k, v) for k,v in STREAMLIT_SESSION_VARS]

# Define function to get user input
def get_user_input() -> str:
    """
    Returns the text entered by the user
    """
    print(st.session_state)    
    prompt = st.text_input("You: ",
                               st.session_state["input"],
                               key="input",
                               placeholder="Ask me a question and I will consult the knowledge base to answer...", 
                               label_visibility='hidden')
    return prompt


# sidebar with options
with st.sidebar.expander("⚙️", expanded=True):
    text2text_model = st.selectbox(label='Text2Text Model', options=TEXT2TEXT_MODEL_LIST)
    embeddings_model = st.selectbox(label='Embeddings Model', options=EMBEDDINGS_MODEL_LIST)
    mode = st.selectbox(label='Mode', options=MODE_VALUES)

# streamlit app layout sidebar + main panel
# the main panel has a title, a sub header and user input textbox
# and a text area for response and history
st.title("👩‍💻 Virtual assistant for a knowledge base")
st.subheader(f" Powered by :blue[{TEXT2TEXT_MODEL_LIST[0]}] for text generation and :blue[{EMBEDDINGS_MODEL_LIST[0]}] for embeddings")
st.markdown(f"**Tenant ID:** :blue[{tenantid}] &emsp; &emsp; **User:** :blue[{user_email}]")

# get user input
user_input: str = get_user_input()
logger.info(f"user_input:{user_input}")


# based on the selected mode type call the appropriate API endpoint
if user_input:
    try:
        sessions = Sessions(dyn_resource)
        sessions_exists = sessions.exists(table_name)
        if sessions_exists:
            session = sessions.get_session(tenant_id)
            if session:
                if ((current_time - session['last_interaction']) < IDLE_TIME):
                    sessions.update_session_last_interaction(tenant_id, current_time)
                    updated_session = sessions.get_session(tenant_id)
                    print(updated_session['session_id'])
                else:
                    sessions.update_session(tenant_id, current_time)
                    updated_session = sessions.get_session(tenant_id)
            else:
                sessions.add_session(tenant_id)
                session = sessions.get_session(tenant_id)
    except Exception as e:
        print(f"Something went wrong: {e}")

    # headers for request and response encoding, same for both endpoints
    headers: Dict = {"accept": "application/json",
                     "Content-Type": "application/json"
                    }
    output = None
    if mode == MODE_RAG:
        user_session_id = tenant_id + ":" + session["session_id"]
        data = {"q": user_input, "user_session_id": user_session_id, "verbose": True}
        resp = req.post(api_rag_ep, headers=headers, json=data)
        if resp.status_code != HTTP_OK:
            output = resp.text
        else:
            resp = resp.json()
            sources = list(set([d['metadata']['source'] for d in resp['docs']]))
            output = f"{resp['answer']} \n \n Sources: {sources}"
    else:
        print("error")
        output = f"unhandled mode value={mode}"
    st.session_state.past.append(user_input)  
    st.session_state.generated.append(output) 

# download the chat history
download_str = []
with st.expander("Conversation", expanded=True):
    for i in range(len(st.session_state['generated'])-1, -1, -1):
        st.info(st.session_state["past"][i],icon="❓") 
        st.success(st.session_state["generated"][i], icon="👩‍💻")
        download_str.append(st.session_state["past"][i])
        download_str.append(st.session_state["generated"][i])
    
    download_str = '\n'.join(download_str)
    if download_str:
        st.download_button('Download', download_str)