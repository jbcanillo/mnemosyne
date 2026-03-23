import React, { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { ragApi } from '../api';
import './DocumentsPanel.css';

const SUPPORTED = ['.pdf', '.xlsx', '.xls', '.csv', '.md', '.txt', '.docx'];
const POLL_INTERVAL = 3000;   // poll every 3s
const POLL_TIMEOUT  = 5 * 60 * 1000; // give up after 5 min

export default function DocumentsPanel({ onRefresh }) {
  const [documents, setDocuments] = useState([]);
  const [uploads, setUploads]     = useState([]);

  useEffect(() => { fetchDocuments(); }, []);

  async function fetchDocuments() {
    try {
      const data = await ragApi.listDocuments();
      setDocuments(data.documents || []);
    } catch (err) {
      toast.error('Failed to load documents: ' + err.message);
    }
  }

  /**
   * Poll the ingest job until completed, failed, or timed out.
   * Updates the upload item status live.
   */
  function pollIngestJob(uid, jobId) {
    const startedAt = Date.now();

    const tick = async () => {
      // Give up after POLL_TIMEOUT
      if (Date.now() - startedAt > POLL_TIMEOUT) {
        setUploads(u => u.map(x => x.id === uid
          ? { ...x, status: 'error', error: 'Processing timed out after 5 minutes.' }
          : x));
        toast.error('Document processing timed out. Check server logs.');
        setTimeout(() => setUploads(u => u.filter(x => x.id !== uid)), 6000);
        return;
      }

      try {
        const data = await ragApi.getIngestStatus(jobId);

        if (data.state === 'completed') {
          const chunks = data.result?.chunks ?? '?';
          setUploads(u => u.map(x => x.id === uid
            ? { ...x, status: 'done', progress: 100, chunks }
            : x));
          toast.success(`Document indexed — ${chunks} chunks added to knowledge base`);
          // Refresh document list then clear the upload item
          await fetchDocuments();
          onRefresh?.();
          setTimeout(() => setUploads(u => u.filter(x => x.id !== uid)), 3000);
          return;
        }

        if (data.state === 'failed') {
          const reason = data.error || 'Unknown error during ingestion.';
          setUploads(u => u.map(x => x.id === uid
            ? { ...x, status: 'error', error: reason }
            : x));
          toast.error(`Ingestion failed: ${reason}`, { duration: 8000 });
          setTimeout(() => setUploads(u => u.filter(x => x.id !== uid)), 8000);
          return;
        }

        // Still processing (waiting / active) — update progress and keep polling
        setUploads(u => u.map(x => x.id === uid
          ? { ...x, status: 'processing', progress: data.progress || 0 }
          : x));
        setTimeout(tick, POLL_INTERVAL);

      } catch (err) {
        // Network hiccup — keep polling
        setTimeout(tick, POLL_INTERVAL * 2);
      }
    };

    setTimeout(tick, 1500); // small initial delay
  }

  const onDrop = useCallback(async (files) => {
    for (const file of files) {
      const uid = Date.now() + Math.random();
      setUploads(u => [...u, { id: uid, name: file.name, progress: 0, status: 'uploading' }]);

      try {
        const result = await ragApi.uploadDocument(
          file,
          p => setUploads(u => u.map(x => x.id === uid ? { ...x, progress: p } : x))
        );

        // File is on the server — now poll the background job
        setUploads(u => u.map(x => x.id === uid
          ? { ...x, status: 'processing', progress: 0 }
          : x));
        toast.success(`${file.name} uploaded — processing started`);
        pollIngestJob(uid, result.jobId);

      } catch (err) {
        setUploads(u => u.map(x => x.id === uid
          ? { ...x, status: 'error', error: err.message }
          : x));
        toast.error(`Upload failed: ${err.message}`);
        setTimeout(() => setUploads(u => u.filter(x => x.id !== uid)), 6000);
      }
    }
  }, [onRefresh]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
      'text/markdown': ['.md'],
      'text/plain': ['.txt'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxSize: 50 * 1024 * 1024
  });

  async function handleDelete(doc) {
    if (!window.confirm(`Remove "${doc.filename}" from the knowledge base?`)) return;
    try {
      await ragApi.deleteDocument(doc.id);
      toast.success(`"${doc.filename}" removed`);
      fetchDocuments();
      onRefresh?.();
    } catch (err) {
      toast.error('Delete failed: ' + err.message);
    }
  }

  const fileIcon = t => ({ pdf:'📕', xlsx:'📗', xls:'📗', csv:'📊', md:'📝', docx:'📘' }[t] || '📄');

  return (
    <div className="docs-panel">
      <div className="panel-title">📚 Knowledge Base Documents</div>

      {/* Drop zone */}
      <div {...getRootProps()} className={`dropzone ${isDragActive ? 'drag-active' : ''}`}>
        <input {...getInputProps()} />
        <div className="dropzone-icon">📤</div>
        {isDragActive
          ? <div className="dropzone-text active">Drop files here…</div>
          : <>
              <div className="dropzone-text">Drag & drop files, or click to browse</div>
              <div className="dropzone-hint">Supported: {SUPPORTED.join(', ')} · Max 50 MB each</div>
            </>
        }
        <button type="button" className="btn btn-primary" style={{ pointerEvents: 'none', marginTop: 8 }}>
          Browse Files
        </button>
      </div>

      {/* Active uploads with live status */}
      {uploads.length > 0 && (
        <div className="uploads-list">
          {uploads.map(up => (
            <div key={up.id} className={`upload-item upload-item-${up.status}`}>
              <div className="upload-info">
                <span className="upload-name">{up.name}</span>
                <span className={`upload-status status-${up.status}`}>
                  {up.status === 'uploading'   && `⬆ Uploading ${up.progress}%`}
                  {up.status === 'processing'  && `⚙ Processing… ${up.progress > 0 ? up.progress + '%' : ''}`}
                  {up.status === 'done'        && `✅ Done — ${up.chunks} chunks indexed`}
                  {up.status === 'error'       && `❌ ${up.error}`}
                </span>
              </div>
              {(up.status === 'uploading' || up.status === 'processing') && (
                <div className="progress-bar">
                  <div
                    className={`progress-fill ${up.status === 'processing' ? 'fill-processing' : ''}`}
                    style={{ width: up.status === 'processing' && up.progress === 0 ? '100%' : `${up.progress}%` }}
                  />
                </div>
              )}
              {up.status === 'error' && (
                <div className="upload-error-detail">{up.error}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Documents table */}
      <div className="docs-table-wrap">
        <div className="docs-table-header">
          <span>{documents.length} document{documents.length !== 1 ? 's' : ''} in knowledge base</span>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 12px' }} onClick={fetchDocuments}>
            ↻ Refresh
          </button>
        </div>

        {documents.length === 0
          ? <div className="empty-state">
              <div className="empty-icon">📭</div>
              <div className="empty-label">No documents yet. Upload your first ERP reference document above.</div>
            </div>
          : (
            <table className="docs-table">
              <thead>
                <tr><th>File</th><th>Type</th><th>Chunks</th><th>Uploaded</th><th></th></tr>
              </thead>
              <tbody>
                {documents.map(doc => (
                  <tr key={doc.id}>
                    <td className="doc-name-cell">
                      <span className="file-icon">{fileIcon(doc.fileType)}</span>
                      <span className="doc-filename">{doc.filename}</span>
                    </td>
                    <td><span className="badge badge-blue">{doc.fileType?.toUpperCase()}</span></td>
                    <td><span className="badge badge-gray">{doc.chunkCount} chunks</span></td>
                    <td className="doc-date">
                      {doc.uploadedAt
                        ? new Date(doc.uploadedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
                        : '—'}
                    </td>
                    <td>
                      <button className="btn btn-danger" style={{ fontSize: 11, padding: '4px 10px' }}
                        onClick={() => handleDelete(doc)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>
    </div>
  );
}
