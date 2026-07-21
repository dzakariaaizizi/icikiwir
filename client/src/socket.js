import { supabase } from './supabaseClient';

class MockSocket {
  constructor() {
    this.listeners = {};
    this.channel = null;
    this.sessionCode = null;
    this.sessionId = null;
    this.role = null;
    this.guestId = null;
    this.connected = false;

    // Auto-trigger connect
    setTimeout(() => {
      this.connected = true;
      this.trigger('connect');
    }, 100);
  }

  on(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  off(event, cb) {
    if (!cb) {
      this.listeners[event] = [];
    } else if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(fn => fn !== cb);
    }
  }

  trigger(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }

  async buildSessionTree(sessionId) {
    const { data: sess } = await supabase.from('sessions').select('*').eq('id', sessionId).single();
    if (!sess) return null;
    
    const { data: qData } = await supabase.from('queue').select('*').eq('session_id', sessionId).order('order_index', { ascending: true });
    const { data: gData } = await supabase.from('guests').select('*').eq('session_id', sessionId);

    // Map guests
    const mappedGuests = (gData || []).map(g => ({
      id: g.id,
      nickname: g.nickname,
      score: g.score || 0,
      totalRequestedSongs: g.total_requested_songs || 0,
      isOnline: true,
      activeSongCount: (qData || []).filter(q => q.guest_id === g.id).length
    }));

    // Map queue
    const mappedQueue = (qData || []).map(q => ({
      id: q.id,
      videoId: q.video_id,
      title: q.title,
      thumbnail: q.thumbnail,
      duration: q.duration,
      guestId: q.guest_id,
      nickname: mappedGuests.find(g => g.id === q.guest_id)?.nickname || 'Unknown',
      addedAt: new Date(q.added_at).getTime()
    }));

    return {
      id: sess.id,
      code: sess.code,
      name: sess.name,
      maxSongsPerGuest: sess.max_songs_per_guest,
      isGuessingGameEnabled: sess.is_guessing_game_enabled,
      correctGuessPoints: 10,
      queueModifyCost: 20,
      currentTrack: sess.current_track,
      isPlaying: sess.is_playing,
      queue: mappedQueue,
      guests: mappedGuests
    };
  }

  subscribeRoom() {
    if (this.channel) return;
    this.channel = supabase.channel(`room:${this.sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue', filter: `session_id=eq.${this.sessionId}` }, async (payload) => {
        const tree = await this.buildSessionTree(this.sessionId);
        if (tree) this.trigger('room:updated', tree);
        
        // If host and something was added and nothing is playing
        if (this.role === 'host' && payload.eventType === 'INSERT') {
           if (!tree.currentTrack && tree.queue.length === 1 && !tree.isPlaying) {
              this.emit('playback:next'); // auto-start
           }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${this.sessionId}` }, async (payload) => {
        const tree = await this.buildSessionTree(this.sessionId);
        if (tree) {
          this.trigger('room:updated', tree);
          
          if (this.role === 'guest') {
             // Let guest know of next track changes
             if (payload.old.current_track?.videoId !== payload.new.current_track?.videoId) {
                this.trigger('playback:next', { track: payload.new.current_track, completed: true });
             }
             this.trigger('playback:state', { isPlaying: payload.new.is_playing });
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guests', filter: `session_id=eq.${this.sessionId}` }, async () => {
        const tree = await this.buildSessionTree(this.sessionId);
        if (tree) this.trigger('room:updated', tree);
      })
      .on('broadcast', { event: 'room_event' }, (payload) => {
        // Handle custom broadcasts like guessing game results
        if (payload.payload.type === 'game:roundResults') {
          this.trigger('game:roundResults', payload.payload.data);
        } else if (payload.payload.type === 'queue:moved') {
          this.trigger('queue:moved', payload.payload.data);
        }
      })
      .subscribe();
  }

  async emit(event, data) {
    if (event === 'host:register' || event === 'host:reconnect') {
      this.role = 'host';
      this.sessionCode = data.sessionId;
      
      let { data: sess } = await supabase.from('sessions').select('*').eq('code', this.sessionCode).single();
      if (!sess) {
        let { data: newSess } = await supabase.from('sessions').insert({ code: this.sessionCode, name: 'OfficeBeats Session' }).select().single();
        sess = newSess;
      }
      this.sessionId = sess.id;
      const tree = await this.buildSessionTree(this.sessionId);
      this.trigger(event === 'host:register' ? 'host:registered' : 'host:reconnected', { session: tree });
      this.subscribeRoom();
    }
    
    if (event === 'guest:rejoin' || event === 'guest:join') {
      this.role = 'guest';
      this.sessionCode = data.code;
      
      let { data: sess } = await supabase.from('sessions').select('*').eq('code', this.sessionCode).single();
      if (!sess) {
        this.trigger('error', { message: 'Sesi tidak ditemukan.' });
        return;
      }
      this.sessionId = sess.id;

      let guestId = data.guestId;
      if (!guestId) {
         const { data: newG } = await supabase.from('guests').insert({ session_id: this.sessionId, nickname: data.nickname }).select().single();
         guestId = newG.id;
      }
      this.guestId = guestId;

      const tree = await this.buildSessionTree(this.sessionId);
      this.trigger(event === 'guest:rejoin' ? 'guest:rejoined' : 'guest:joined', { guestId, nickname: data.nickname, session: tree });
      this.subscribeRoom();
    }

    if (event === 'queue:add') {
      this.trigger('queue:validating');
      const url = data.url;
      // Extract video ID
      let videoId = null;
      const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
      ];
      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) { videoId = match[1]; break; }
      }

      if (!videoId) {
        this.trigger('queue:add:rejected', { reason: 'URL tidak valid.' });
        return;
      }

      try {
        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        const oembed = await res.json();
        
        if (oembed.error || !oembed.title) {
          this.trigger('queue:add:rejected', { reason: 'Video tidak ditemukan atau diblokir.' });
          return;
        }

        // Get current max order_index
        const { data: qList } = await supabase.from('queue').select('order_index').eq('session_id', this.sessionId).order('order_index', { ascending: false }).limit(1);
        const orderIndex = qList && qList.length > 0 ? qList[0].order_index + 1 : 0;

        await supabase.from('queue').insert({
          session_id: this.sessionId,
          guest_id: this.guestId,
          video_id: videoId,
          title: oembed.title,
          thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          duration: 180, // Fake duration since oEmbed doesn't return duration
          order_index: orderIndex
        });

        // Add to totalRequestedSongs
        const { data: g } = await supabase.from('guests').select('total_requested_songs').eq('id', this.guestId).single();
        await supabase.from('guests').update({ total_requested_songs: (g?.total_requested_songs || 0) + 1 }).eq('id', this.guestId);

        this.trigger('queue:add:success', { track: {} });
      } catch (err) {
        this.trigger('queue:add:rejected', { reason: 'Gagal memvalidasi link.' });
      }
    }

    if (event === 'playback:ended' || event === 'playback:skip' || event === 'playback:start' || event === 'playback:next') {
      const tree = await this.buildSessionTree(this.sessionId);
      if (!tree) return;
      
      if (tree.queue.length === 0) {
        await supabase.from('sessions').update({ current_track: null, is_playing: false }).eq('id', this.sessionId);
        this.trigger('playback:next', { track: null, completed: true });
        return;
      }

      const nextTrack = tree.queue[0];
      await supabase.from('queue').delete().eq('id', nextTrack.id);
      
      const sessTrack = { videoId: nextTrack.videoId, title: nextTrack.title, thumbnail: nextTrack.thumbnail, guestId: nextTrack.guestId };
      await supabase.from('sessions').update({ current_track: sessTrack, is_playing: true }).eq('id', this.sessionId);
      
      await supabase.from('history').insert({ session_id: this.sessionId, video_id: nextTrack.videoId, title: nextTrack.title, thumbnail: nextTrack.thumbnail });
      
      this.trigger('playback:next', { track: sessTrack, completed: true });
    }

    if (event === 'playback:state') {
      await supabase.from('sessions').update({ is_playing: data.isPlaying }).eq('id', this.sessionId);
    }
    
    if (event === 'queue:remove') {
       await supabase.from('queue').delete().eq('id', data.trackId);
    }

    if (event === 'session:setLimit') {
       await supabase.from('sessions').update({ max_songs_per_guest: data.limit }).eq('id', this.sessionId);
    }

    if (event === 'session:toggleGuessingGame') {
       await supabase.from('sessions').update({ is_guessing_game_enabled: data.enabled }).eq('id', this.sessionId);
    }
  }

  disconnect() {
    this.connected = false;
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }
}

let mockInstance = null;

export function getSocket() {
  if (!mockInstance) mockInstance = new MockSocket();
  return mockInstance;
}

export function connectSocket() {
  const s = getSocket();
  return s;
}

export function disconnectSocket() {
  if (mockInstance) {
    mockInstance.disconnect();
    mockInstance = null;
  }
}
