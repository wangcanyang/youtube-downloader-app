import React, { useState, useRef, useEffect } from 'react';
import { Layout, Typography, Input, Button, Table, message, Spin, Progress } from 'antd';
import axios from 'axios';
import 'antd/dist/reset.css';
import './App.css';

const { Header, Content, Footer } = Layout;
const { Title } = Typography;

function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [videoInfo, setVideoInfo] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState([]);
  const progressTimer = useRef(null);

  // 获取历史记录
  const fetchHistory = async () => {
    try {
      const res = await axios.get('http://127.0.0.1:8000/api/history');
      if (res.data.success) {
        setHistory(res.data.data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  // 表格列定义
  const columns = [
    {
      title: '字段名称',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '字段值',
      dataIndex: 'value',
      key: 'value',
      render: (text, record) =>
        record.name === '封面大图' && text ? (
          <img src={text} alt="封面" style={{ maxWidth: 200 }} />
        ) : (
          <div style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{text}</div>
        ),
    },
  ];

  // 历史记录表格列
  const historyColumns = [
    { title: '视频标题', dataIndex: '视频标题', key: 'title' },
    { title: '文件名', dataIndex: '文件名', key: 'filename' },
    { title: '文件大小', dataIndex: '文件大小', key: 'size', render: size => `${(size/1024/1024).toFixed(2)} MB` },
    { title: '下载时间', dataIndex: '下载时间', key: 'time' },
  ];

  // 解析视频
  const handleParse = async () => {
    if (!url.trim()) {
      message.warning('请输入YouTube视频链接');
      return;
    }
    setLoading(true);
    setVideoInfo(null);
    try {
      const res = await axios.get('http://127.0.0.1:8000/api/parse', {
        params: { url },
      });
      if (res.data.success) {
        setVideoInfo(res.data.data);
      } else {
        message.error('解析失败: ' + res.data.error);
      }
    } catch (err) {
      message.error('请求失败，请检查后端服务是否启动');
    }
    setLoading(false);
  };

  // 下载视频（分步：启动任务-轮询进度-下载文件）
  const handleDownload = async () => {
    if (!url.trim()) {
      message.warning('请输入YouTube视频链接');
      return;
    }
    setDownloading(true);
    setProgress(0);
    const task_id = Date.now().toString();
    try {
      // 1. 启动下载任务
      const res = await axios.get('http://127.0.0.1:8000/api/download', {
        params: { url, task_id },
      });
      if (!res.data.success) {
        message.error('下载任务启动失败: ' + res.data.error);
        setDownloading(false);
        return;
      }
      // 2. 轮询进度
      progressTimer.current = setInterval(async () => {
        try {
          const resp = await axios.get('http://127.0.0.1:8000/api/progress', {
            params: { task_id },
          });
          setProgress(resp.data.progress);
          if (resp.data.progress >= 100) {
            clearInterval(progressTimer.current);
            setTimeout(async () => {
              // 3. 下载视频文件
              const fileResp = await axios.get('http://127.0.0.1:8000/api/download', {
                params: { url, task_id },
                responseType: 'blob',
              });
              const blob = new Blob([fileResp.data], { type: 'video/mp4' });
              const downloadUrl = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = downloadUrl;
              a.download = 'video.mp4';
              document.body.appendChild(a);
              a.click();
              a.remove();
              window.URL.revokeObjectURL(downloadUrl);
              message.success('下载成功');
              setDownloading(false);
              setProgress(0);
              fetchHistory(); // 下载成功后刷新历史
            }, 1000); // 延迟1秒，确保文件写入完成
          }
        } catch (err) {
          clearInterval(progressTimer.current);
          message.error('下载失败，请检查后端服务或视频链接');
          setDownloading(false);
          setProgress(0);
        }
      }, 1000);
    } catch (err) {
      message.error('下载失败，请检查后端服务或视频链接');
      setDownloading(false);
      setProgress(0);
    }
  };

  // 表格数据
  const dataSource = videoInfo
    ? Object.entries(videoInfo).map(([name, value]) => ({ key: name, name, value }))
    : [];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#1677ff' }}>
        <Title style={{ color: '#fff', margin: 0 }} level={3}>
          火山YouTube视频下载
        </Title>
      </Header>
      <Content style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: 600, marginTop: 40 }}>
          <Input.Search
            placeholder="请输入YouTube视频链接"
            enterButton="解析视频"
            size="large"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onSearch={handleParse}
            loading={loading}
            allowClear
          />
        </div>
        <div style={{ width: '100%', maxWidth: 600, marginTop: 32 }}>
          {loading ? (
            <Spin tip="正在解析视频..." />
          ) : videoInfo ? (
            <>
              <Table
                columns={columns}
                dataSource={dataSource}
                pagination={false}
                bordered
                style={{ marginTop: 16 }}
              />
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <Button
                  type="primary"
                  size="large"
                  loading={downloading}
                  onClick={handleDownload}
                  style={{ width: 200 }}
                  disabled={downloading}
                >
                  下载视频
                </Button>
              </div>
              {downloading && (
                <div style={{ marginTop: 24 }}>
                  <Progress percent={progress} status={progress < 100 ? 'active' : 'success'} />
                </div>
              )}
            </>
          ) : null}
        </div>
        <div style={{ width: '100%', maxWidth: 800, margin: '40px auto' }}>
          <h3>历史下载记录</h3>
          <Table columns={historyColumns} dataSource={history} rowKey="文件名" pagination={false} />
        </div>
      </Content>
      <Footer style={{ textAlign: 'center', background: '#f0f2f5' }}>
        ©2025 火山YouTube视频下载器，仅供学习使用，联系人：火山哥，邮箱：123456@gmail.com。
      </Footer>
    </Layout>
  );
}

export default App;