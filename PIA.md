# Privacy Impact Assessment (PIA) for Mnemosyne RAG System

## Executive Summary
Mnemosyne is a self-hosted Retrieval-Augmented Generation (RAG) system that processes company documents to answer queries. This PIA evaluates privacy risks associated with processing sensitive company information under the Philippine Data Privacy Act (RA 10173).

## Project Overview
- **System Purpose**: Answer questions based exclusively on uploaded company manuals, processes, policies, and regulations.
- **Data Processing**: Document ingestion, embedding, vector storage, and query response generation.
- **Users**: Admin (UI access), API key holders (third-party integrations).

## Data Processing Scope
- **Personal Data**: Primarily company data; minimal PII if any (consent obtained).
- **Processing Activities**:
  - Document upload and parsing.
  - Text chunking and embedding.
  - Vector storage and similarity search.
  - LLM generation of responses.
- **Data Flows**:
  - Upload → Parsing → Chunking → Embedding → Vector DB.
  - Query → Embedding → Search → LLM Generation → Response.

## Legal Basis and Compliance
- **Lawful Basis**: Consent (obtained for any personal data processing).
- **Data Principles**:
  - Lawfulness, Fairness, Transparency: Clear system prompts and logging.
  - Purpose Limitation: Only for answering queries from documents.
  - Data Minimization: Only necessary document content processed.
  - Accuracy: Documents are accurate as uploaded.
  - Storage Limitation: Retained as needed.
  - Integrity and Confidentiality: Encryption, access controls.
  - Accountability: Logging and auditing.

## Risk Assessment
- **High Risks**:
  - Unauthorized access to sensitive documents via jailbreaks.
  - Data breaches exposing company information.
- **Mitigations**:
  - Input validation and filtering.
  - Access authentication (API keys, sessions).
  - Encryption at rest/transit.
  - Logging and monitoring.

## Risk Mitigation Measures
- **Technical**: Prompt hardening, injection detection, output filtering.
- **Organizational**: Admin-only uploads, audit logs.
- **Governance**: Regular reviews, compliance with NPC.

## Data Subject Rights
- **Access**: Admin can view uploaded documents.
- **Rectification/Erasure**: Admin can delete/modify documents.
- **Objection**: Not applicable (no automated decisions).

## Conclusions and Recommendations
The system poses low risk to individuals due to focus on company data. Implement recommended security measures. Conduct annual PIA reviews.