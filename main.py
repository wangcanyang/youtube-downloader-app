from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict
import yt_dlp
import os
import uuid
import threading
import json
from datetime import datetime
import time

HISTORY_FILE = "download_history.json"

def add_history_record(title, filename, filesize):
    record = {
        "视频标题": title,
        "文件名": filename,
        "文件大小": filesize,
        "下载时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                history = json.load(f)
        else:
            history = []
        history.insert(0, record)  # 新记录放最前面
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("写入历史记录失败：", e)

app = FastAPI()

# 允许跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局变量：记录每个下载任务的进度
download_progress: Dict[str, int] = {}
download_files: Dict[str, str] = {}

@app.get("/api/parse")
def parse_youtube(url: str = Query(..., description="YouTube视频链接")):
    try:
        ydl_opts = {
            'quiet': True,
            'skip_download': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            result = {
                "封面大图": info.get("thumbnail"),
                "视频标题": info.get("title"),
                "视频描述": info.get("description"),
                "上传日期": info.get("upload_date"),
                "文件大小": info.get("filesize") or info.get("filesize_approx"),
            }
            return JSONResponse(content={"success": True, "data": result})
    except Exception as e:
        return JSONResponse(content={"success": False, "error": str(e)})

@app.get("/api/download")
def download_youtube(
    url: str = Query(..., description="YouTube视频链接"),
    task_id: str = Query(None, description="任务ID")
):
    try:
        out_dir = "downloads"
        os.makedirs(out_dir, exist_ok=True)

        if not task_id:
            return JSONResponse(content={"success": False, "error": "缺少task_id"})

        # 如果任务已完成，返回文件
        if download_progress.get(task_id, 0) == 100 and task_id in download_files:
            output_path = download_files[task_id]
            # 等待文件写入完成
            wait_time = 0
            while (not os.path.exists(output_path) or os.path.getsize(output_path) < 1024) and wait_time < 10:
                time.sleep(0.5)
                wait_time += 0.5
            if os.path.exists(output_path) and os.path.getsize(output_path) >= 1024:
                # 获取视频标题和文件大小
                title = ""
                filesize = os.path.getsize(output_path)
                try:
                    ydl_opts_info = {
                        'quiet': True,
                        'skip_download': True,
                    }
                    with yt_dlp.YoutubeDL(ydl_opts_info) as ydl:
                        info = ydl.extract_info(url, download=False)
                        title = info.get("title", "")
                except Exception:
                    pass
                add_history_record(title, os.path.basename(output_path), filesize)
                return FileResponse(output_path, filename="video.mp4", media_type="video/mp4")
            else:
                return JSONResponse(content={"success": False, "error": "文件不存在或未写入完成"})

        # 否则，启动下载任务
        filename = f"{uuid.uuid4()}.mp4"
        output_path = os.path.join(out_dir, filename)
        download_files[task_id] = output_path

        def progress_hook(d):
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate') or 1
                downloaded = d.get('downloaded_bytes', 0)
                percent = int(downloaded / total * 100)
                download_progress[task_id] = percent
            elif d['status'] == 'finished':
                download_progress[task_id] = 100

        ydl_opts = {
            'outtmpl': output_path,
            'format': 'bestvideo+bestaudio/best',
            'merge_output_format': 'mp4',
            'quiet': True,
            'progress_hooks': [progress_hook],
        }

        def download_task():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

        if task_id not in download_progress:
            download_progress[task_id] = 0
            thread = threading.Thread(target=download_task)
            thread.start()

        return JSONResponse(content={"success": True, "task_id": task_id, "filename": filename})
    except Exception as e:
        return JSONResponse(content={"success": False, "error": str(e)})

@app.get("/api/progress")
def get_progress(task_id: str):
    percent = download_progress.get(task_id, 0)
    return {"progress": percent}

@app.get("/api/history")
def get_history():
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                history = json.load(f)
        else:
            history = []
        return {"success": True, "data": history}
    except Exception as e:
        return {"success": False, "error": str(e)}