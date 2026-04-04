import React, { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { Upload, FileText, FileSpreadsheet, File, Trash2, CheckCircle, XCircle, Loader2, Inbox, Tag, X, Edit2, RefreshCw, Download } from 'lucide-react';
import { ragApi } from '../api';
import './DocumentsPanel.css';

const SUPPORTED = ['.pdf', '.xlsx', '.xls', '.csv', '.md', '.txt', '.docx'];
const POLL_INTERVAL = 3000;   // poll every 3s
const POLL_TIMEOUT  = 5 * 60 * 1000; // give up after 5 min

export default function DocumentsPanel({ onRefresh }) {
  const [documents, setDocuments] = useState([]);
  const [uploads, setUploads]     = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [filterTags, setFilterTags] = useState([]);
  const [editingDocId, setEditingDocId] = useState(null);
  const [editTags, setEditTags] = useState([]);
  const [editTagInput, setEditTagInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchFilename, setSearchFilename] = useState('');
  const [sortField, setSortField] = useState('uploadedAt');
  const [sortDirection, setSortDirection] = useState('desc');

  useEffect(() => { fetchDocuments(); fetchTags(); }, []);

  async function fetchDocuments() {
    try {
      const data = await ragApi.listDocuments(filterTags.length > 0 ? filterTags : null);
      // Sort by latest uploaded first (descending date)
      const sorted = (data.documents || []).sort((a, b) => {
        const dateA = new Date(a.uploadedAt || 0).getTime();
        const dateB = new Date(b.uploadedAt || 0).getTime();
        return dateB - dateA;
      });
      setDocuments(sorted);
    } catch (err) {
      toast.error('Failed to load documents: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleColumnSort(field) {
    if (sortField === field) {
      // Toggle sort direction if clicking same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }

  function getSortedDocuments() {
    let sorted = [...documents];

    // Filter by search
    if (searchFilename.trim()) {
      sorted = sorted.filter(doc =>
        doc.filename.toLowerCase().includes(searchFilename.toLowerCase())
      );
    }

    // Sort by selected field
    sorted.sort((a, b) => {
      let aVal, bVal;
      if (sortField === 'filename') {
        aVal = a.filename.toLowerCase();
        bVal = b.filename.toLowerCase();
      } else if (sortField === 'chunkCount') {
        aVal = a.chunkCount || 0;
        bVal = b.chunkCount || 0;
      } else if (sortField === 'uploadedAt') {
        aVal = new Date(a.uploadedAt || 0).getTime();
        bVal = new Date(b.uploadedAt || 0).getTime();
      } else {
        return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }

  function SortHeader({ field, label }) {
    const isActive = sortField === field;
    return (
      <th onClick={() => handleColumnSort(field)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {label}
          {isActive && <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>}
        </div>
      </th>
    );
  }

  async function fetchTags() {
    try {
      const data = await ragApi.getTags();
      setAvailableTags(data.tags || []);
    } catch (err) {
      console.warn('Failed to load tags:', err.message);
    }
  }

  // ── Tag helpers ──────────────────────────────────────────────────
  function addTag(tag, target, setTarget) {
    const normalized = tag.trim().toLowerCase();
    if (normalized && !target.includes(normalized)) {
      setTarget([...target, normalized]);
    }
  }

  function removeTag(tag, target, setTarget) {
    setTarget(target.filter(t => t !== tag));
  }

  function handleEditTagInputKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(editTagInput, editTags, setEditTags);
      setEditTagInput('');
    } else if (e.key === 'Backspace' && !editTagInput && editTags.length > 0) {
      removeTag(editTags[editTags.length - 1], editTags, setEditTags);
    }
  }

  // ── Filter handling ─────────────────────────────────────────────
  async function toggleFilterTag(tag) {
    const newFilter = filterTags.includes(tag)
      ? filterTags.filter(t => t !== tag)
      : [...filterTags, tag];
    setFilterTags(newFilter);
    try {
      const data = await ragApi.listDocuments(newFilter.length > 0 ? newFilter : null);
      setDocuments(data.documents || []);
    } catch (err) {
      toast.error('Failed to filter documents: ' + err.message);
    }
  }

  function clearFilters() {
    setFilterTags([]);
    fetchDocuments();
  }

  // ── Tag editing for existing documents ──────────────────────────
  function startEditTags(doc) {
    setEditingDocId(doc.id);
    setEditTags([...doc.tags]);
    setEditTagInput('');
  }

  async function saveEditTags(docId) {
    try {
      await ragApi.updateDocumentTags(docId, editTags);
      toast.success('Tags updated');
      setEditingDocId(null);
      await fetchDocuments();
      await fetchTags();
      onRefresh?.();
    } catch (err) {
      toast.error('Failed to update tags: ' + err.message);
    }
  }

  function cancelEditTags() {
    setEditingDocId(null);
    setEditTags([]);
    setEditTagInput('');
  }

  /**
   * Poll the ingest job until completed, failed, or timed out.
   * Updates the upload item status live with exponential backoff on errors.
   */
  function pollIngestJob(uid, jobId) {
    const startedAt = Date.now();
    let failureCount = 0;

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
        failureCount = 0; // Reset on success

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
        // Exponential backoff on errors (rate limit or network issues)
        failureCount++;
        const backoffDelay = POLL_INTERVAL * Math.pow(1.5, Math.min(failureCount, 3));
        console.warn(`[Poll ${uid}] Error (attempt ${failureCount}), backing off ${Math.round(backoffDelay)}ms:`, err.message);
        setTimeout(tick, backoffDelay);
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
          [],
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

  async function handleDownload(doc) {
    try {
      // Create download URL for the document
      const downloadUrl = `${process.env.REACT_APP_API_URL || ''}/documents/${doc.id}/download`;
      
      // Create a temporary link with proper headers
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = doc.filename;
      
      // Add session token to the request via fetch to handle auth
      const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
          'X-Session-Token': sessionStorage.getItem('rag_token')
        },
        credentials: 'include'
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          toast.error('Session expired. Please log in again.');
          return;
        }
        throw new Error(`Download failed: ${response.statusText}`);
      }
      
      // Create object URL from the response blob
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
      toast.success(`Downloading "${doc.filename}"`);
    } catch (err) {
      toast.error('Download failed: ' + err.message);
    }
  }

  const fileIcon = t => {
    const icons = {
      pdf: <FileText size={18} />,
      xlsx: <FileSpreadsheet size={18} />,
      xls: <FileSpreadsheet size={18} />,
      csv: <FileSpreadsheet size={18} />,
      md: <FileText size={18} />,
      docx: <FileText size={18} />,
    };
    return icons[t] || <File size={18} />;
  };

  return (
    <div className="docs-panel">

      {/* Drop zone */}
      <div {...getRootProps()} className={`dropzone ${isDragActive ? 'drag-active' : ''}`}>
        <input {...getInputProps()} />
        <div className="dropzone-icon"><Upload size={36} /></div>
        {isDragActive
          ? <div className="dropzone-text active">Drop files here…</div>
          : <>
              <div className="dropzone-text">Drag & drop files, or click to browse</div>
              <div className="dropzone-hint">Supported: {SUPPORTED.join(', ')} · Max 50 MB each</div>
            </>
        }
        <button type="button" className="btn btn-primary" style={{ pointerEvents: 'none', marginTop: 8 }}>
          Upload Files
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
                  {up.status === 'uploading'   && <><Loader2 size={12} className="spin" /> Uploading {up.progress}%</>}
                  {up.status === 'processing'  && <><Loader2 size={12} className="spin" /> Processing… {up.progress > 0 ? up.progress + '%' : ''}</>}
                  {up.status === 'done'        && <><CheckCircle size={12} /> Done — {up.chunks} chunks indexed</>}
                  {up.status === 'error'       && <><XCircle size={12} /> {up.error}</>}
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

      {/* Document search and filter card */}
      <div className="document-filter-card">
        <div className="filter-card-header">
          <div className="filter-card-title"><Tag size={14} /> Search & Filter Documents</div>
          {(searchFilename.trim() || filterTags.length > 0) && (
            <button className="btn btn-ghost btn-xs" onClick={() => {
              setSearchFilename('');
              clearFilters();
            }}>
              Clear all
            </button>
          )}
        </div>
        <div className="filter-card-content">
          <div className="filter-search-row">
            <input
              type="text"
              placeholder="Search by filename…"
              className="document-search-input"
              value={searchFilename}
              onChange={e => setSearchFilename(e.target.value)}
            />
          </div>
          {availableTags.length > 0 && (
            <div className="filter-tags-row">
              <div className="filter-tags-label">Filter by tags:</div>
              <div className="filter-tag-chips">
                {availableTags.map(tag => (
                  <button
                    key={tag}
                    className={`filter-tag-chip ${filterTags.includes(tag) ? 'active' : ''}`}
                    onClick={() => toggleFilterTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Documents table */}
      <div className="docs-table-wrap">
          <div className="docs-table-header">
            <span>{documents.length} document{documents.length !== 1 ? 's' : ''} in knowledge base</span>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 12px' }} onClick={fetchDocuments}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

        {getSortedDocuments().length === 0 && documents.length === 0
          ? <div className="empty-state">
              <div className="empty-icon"><Inbox size={40} /></div>
              <div className="empty-label">No documents uploaded yet.</div>
            </div>
          : getSortedDocuments().length === 0 && searchFilename.trim()
          ? <div className="empty-state">
              <div className="empty-icon"><Inbox size={40} /></div>
              <div className="empty-label">No documents match "{searchFilename}"</div>
            </div>
          : (
            <table className="docs-table">
              <thead>
                <tr><SortHeader field="filename" label="File" /><th>Type</th><SortHeader field="chunkCount" label="Chunks" /><th>Tags</th><SortHeader field="uploadedAt" label="Uploaded" /><th></th></tr>
              </thead>
              <tbody>
                {getSortedDocuments().map(doc => (
                  <tr key={doc.id}>
                    <td className="doc-name-cell">
                      <span className="file-icon">{fileIcon(doc.fileType)}</span>
                      <span className="doc-filename">{doc.filename}</span>
                    </td>
                    <td><span className="badge badge-blue">{doc.fileType?.toUpperCase()}</span></td>
                    <td><span className="badge badge-gray">{doc.chunkCount} chunks</span></td>
                    <td className="doc-tags-cell">
                      {editingDocId === doc.id ? (
                        <div className="tag-edit-container">
                          <div className="tag-input-wrapper small">
                            {editTags.map(tag => (
                              <span key={tag} className="tag-chip small">
                                {tag}
                                <button type="button" className="tag-remove" onClick={() => removeTag(tag, editTags, setEditTags)}>
                                  <X size={10} />
                                </button>
                              </span>
                            ))}
                            <input
                              type="text"
                              className="tag-input small"
                              placeholder="Add tag..."
                              value={editTagInput}
                              onChange={e => setEditTagInput(e.target.value)}
                              onKeyDown={handleEditTagInputKeyDown}
                              list="available-tags-list"
                            />
                          </div>
                          <div className="tag-edit-actions">
                            <button className="btn btn-xs btn-success" onClick={() => saveEditTags(doc.id)}>Save</button>
                            <button className="btn btn-xs btn-ghost" onClick={cancelEditTags}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="doc-tags-display">
                          {doc.tags && doc.tags.length > 0 ? (
                            doc.tags.map(tag => (
                              <span key={tag} className="tag-chip small">{tag}</span>
                            ))
                          ) : (
                            <span className="no-tags">No tags</span>
                          )}
                          <button
                            className="btn-icon btn-ghost tag-edit-btn"
                            onClick={() => startEditTags(doc)}
                            title="Edit tags"
                          >
                            <Edit2 size={12} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="doc-date">
                      {doc.uploadedAt
                        ? new Date(doc.uploadedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
                        : '—'}
                    </td>
                    <td>
                      <div className="doc-actions">
                        <button className="btn btn-ghost btn-sm doc-download-btn"
                          onClick={() => handleDownload(doc)}
                          title="Download file">
                          <Download size={16} />
                        </button>
                        <button className="btn btn-danger btn-sm doc-delete-btn"
                          onClick={() => handleDelete(doc)}
                          title="Remove document">
                          <Trash2 size={16} />
                        </button>
                      </div>
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
