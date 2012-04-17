(function($) {
$.django = function(method){
    var methods = {
        init : function(options) {
            var settings = $.extend({
                'urls' : [],
                'no_match' : function(url){
                    window.location = url;
                },
                'active': []
            }, options);
            $(window).data('django', settings);
            $(window).bind('popstate', function(){ $.django('statechange') });
            $.django('anchors');

            /* TODO -- some browsers fire the popstate event immediately upon page load,
            meaning that inital view will be loaded twice since there are 2 calls to
            $.django('statechange')
            */
            $(window).data('django').was_popped = ('state' in window.history);
            $(window).data('django').initial = location.href;

            $.django('statechange', false);
            return this;
        },
        pushstate : function(obj, title, url){
            /*
            TODO -- determine workaround for browser compatibility if the browser doesn't support
            pushState yet
            */
            window.history.pushState(obj, title, url);
            $.django('statechange');
            return this;
        },
        statechange : function() {
            /*
            Called when the url is changed and a new view should be called
            */
            //var initialPop = !$(window).data('django').popped && location.href == $(window).data('django').initial;
            //$(window).data('django').popped = true;
            //if (initialPop) return false;

            if (!$(window).data('django').urls) return $.error('No URLS defined!');

            var url = $.django('url');
            for (var i in $(window).data('django').urls){
                var match = url.match($(window).data('django').urls[i].url);
                if (match) {
                    if ($(window).data('django').urls[i].redirect){
                        return $.django('pushstate', {}, '',
                            $.django('url', $(window).data('django').urls[i].redirect));
                    }
                    else{
                        var view = $(window).data('django').urls[i].view;
                        var requirements = $.django('requirements', view);
                        var active = $.extend(true, [], $(window).data('django').active);

                        // unload neccesary instances
                        for (var i=0; i<active.length; i++){
                            var remove = true;
                            for (var ii=0; ii<requirements.length; ii++){
                                if (active[i] instanceof requirements[ii]){
                                    remove = false;
                                }
                            }
                            if (remove) $.django('unload', active[i]);
                        }

                        // load neccesary views
                        return $.django('load', view, match);
                    }
                }
            }
            return $(window).data('django').no_match(url);
        },
        anchors : function() {
            /*
            Hijack all the the pages anchors and attach a event handler
            that updates the page's location via a pushState change instead of
            actually reloading the page

            This is run after each view is loaded, and must also be run anytime that new
            HTML (with new anchor tags) is inserted into the page (be it via ajax, etc)
            */
            $('a').off('click.django');
            $('a').on('click.django', function(){
                if ($(this).attr('href') && $(this).attr('href') != '#'){
                    try{ $.django('pushstate', {}, '', $(this).attr('href')); }
                    catch (e){ $.error(e) }
                }
                return false;
            });
            if ($(window).data('django').anchor_callback) $(window).data('django').anchor_callback.call();
        },
        load : function(view, match) {
            /*
            Does the work for loading a new view

            For each view, it is the author of a view's responsibility to impliment
            a method called 'load'. Into the load method are passed the
            parameters that came from the regular expression match
            of the page's URL.

            e.g. Let's say that your URL pattern has the
            form /article/50/ where "50" in this case represents an variable ID
            that your view would require.

            The regex for this url may look like:
                /\/article\/(.[^\/]*)\/?/

            And the view would look like:
                function myView(){
                    this.render = function(url, article_id){
                        // do something
                    }
                }

            If a view is a "subview", and thus requires that another view be loaded
            before it is called, simply set the 'requires' attribute of the object to
            the view that needs to be loaded first. Note, this will render the required
            view first, and in a synchronous manner, before loading the current view. In order
            to accomplish this (and if synchronicity is important to you), ensure that
            the return from the load method returns a deferred (new in jquery 1.5) that will
            resolve when the next view is ready to be loaded.

            Good article on deferreds: http://www.erichynds.com/jquery/using-deferreds-in-jquery/

            e.g.
            var mySubView = function(){
                this.requires = myBaseView

                this.load = function(){
                    var deferred = $.Deferred();
                    $.when($.ajax('/api')).done(function(){
                        // do something...
                        deferred.resolve();
                    })
                    return deferred;
                }
            }

            Also, by setting the 'title' attribute of a view object, the window's title will be updated
            upon rendering
            */
            if (!view) return true;
            if ($.django('isloaded', view)){
                $.django('reload', view, match);
                return true;
            }
            var instance = new view();
            return function(defer){
                $.when($.django('load', instance.requires, match)).done(
                    function(view, match){
                        return function(){
                            var d = view.load.apply(view, match);
                            $(window).data('django').active.push(view);
                            $.when(d).done(function(){
                                defer.resolve();
                                if (view.title) document.title = view.title;
                                return $.django('anchors');
                            });
                        }
                    }(instance, match));
                return defer;
            }($.Deferred());
        },
        unload: function(instance){
            /*
            (Optional) Called when a view is destroyed.
            */
            var active = $.extend(true, [], $(window).data('django').active);
            for (var i in active){
                if (active[i] == instance){
                    $(window).data('django').active.splice(i, 1);
                }
            }
            if (instance.unload) instance.unload.call(instance);

        },
        reload: function(view, match){
            /*
            (Optional) Called when a loaded again
            */
            var active = $.extend(true, [], $(window).data('django').active);
            for (var i=0; i<active.length; i++){
                if (active[i] instanceof view){
                    if (active[i].reload) active[i].reload.apply(active[i], match);
                }
            }
        },
        isloaded: function(view){
            var active = $.extend(true, [], $(window).data('django').active);
            for (var i=0; i<active.length; i++){
                if (active[i] instanceof view) return true;
            }
            return false;
        },
        requirements: function(view){
            /*
            Recusively iterates thru a view's list of required subviews and returns
            a list of each required view (plus itself).

            This is used for determining what views to unload upon a new statechange -- you
            probably won't ever need to call this method externally
            */
            var i = new view();
            if (!i.requires) return [view]
            else return [view].concat($.django('requirements', i.requires));
        },
        url : function(name, params){
            /*
            Return the url, as a string, for a view given the view's 'name' attribute.
            */
            if (!name) return window.location.pathname;
            for (var i in $(window).data('django').urls){
                if ($(window).data('django').urls[i].name == name){
                    return $.django('reverse', $(window).data('django').urls[i].url, params);
                }
            }
        },
        reverse : function(regex, params) {
            /*
            Super bootleg -- I can't find another better method though. Please help.
            */
            params = params || [];
            var s = String(regex);
            s = s.substr(1, s.length - 2);
            s = s.replace(/\\/g, '');
            s = s.replace(/\?/g, '');
            s = s.replace(/\$/g, '');
            var matches = s.match(/\(.*\)\??/) || [];
            for (var i=0; i<matches.length; i++){
                var param = '';
                if (params[i] !== null) param = String(params[i]);
                s = s.replace(matches[i], param);
            }
            return s;
        },
        toggle : function(x) {
            /*
            Useful function for toggling state between a group of HTML elements
            Common example is changing the class of a link when it is "active"

            @input
            x.group -- jquery selection of elements e.g. $('#nav li')

            x.select -- function called on each element from x.group and returns
                        true/false to signify whether or not the element is "active"
                        e.g. function(){ return this.html() == 'Home' }

            x.active -- function called on each element that is considered "active"
                        e.g. function(){ this.addClass('active') }

            x.inactive -- function called on each element that is considered "inactive"
                        e.g. function(){ this.removeClass('active') }
            */
            $(x.group).each(function(index, element){
                if (x.select.call($(element))) x.active.call($(element));
                else x.inactive.call($(element));
            })
        },
        model : function(options){
            this.attr = function(name){
                var f = function(obj, attr){
                    this.save = function(){
                        obj.attrs[attr].old = obj.attrs[attr].val;
                    }
                    this.revert = function(){
                        obj.attrs[attr].val = obj.attrs[attr].old;
                        this.update();
                    }
                    this.val = function(value){
                        if (value === undefined) return obj.attrs[attr].val;
                        if (!obj.attrs[attr].val){
                            obj.attrs[attr].val = value;
                            obj.attrs[attr].old = value;
                        }
                        else{
                            obj.attrs[attr].val = value;
                        }
                        this.update();
                    }
                    this.html = function(){
                        return '<span class="'+this.class()+'">'+this.val()+'</span>';
                    }
                    this.update = function(){
                        $('.'+this.class()).html(this.val());
                    }
                    this.class = function(){
                        return 'model_' + obj.uid + '_' + name;
                    }
                    this.follow = function(input){
                        input.on('keyup', function(e){
                            if (e.keyCode == 27) return;
                            obj.attr(attr).val($(e.srcElement).val());
                        });
                    }
                    if (!obj.attrs) obj.attrs = {};
                    if (!obj.attrs[name]){
                        obj.attrs[name] = {
                            val: null,
                            old: null
                        }
                    }
                    return this;
                }
                f.prototype.toString = function(){
                    return this.val();
                }
                return new f(this, name);

            },
            this.revert = function(){
                for (var name in this.attrs){
                    this.attr(name).revert();
                }
            },
            this.save = function(data){
                if (data){
                    for (var key in data){
                        this.attr(key).val(data[key]);
                    }
                }
                for (var name in this.attrs){
                    this.attr(name).save();
                }

            },
            this.update = function(){
                for (var name in this.attrs){
                    this.attr(name).update();
                }
            }
        }
    };

    // Method calling logic
    if (methods[method]){
        return methods[method].apply(this, Array.prototype.slice.call(arguments, 1));
    }
    else if (typeof method === 'object' || ! method){
        return methods.init.apply( this, arguments );
    }
    else {
        $.error( 'Method ' + method + ' does not exist on jQuery.django' );
    }
}
})(jQuery);
